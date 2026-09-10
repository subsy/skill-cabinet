import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import YAML from "yaml";
import { auditSkill } from "./audit.js";
import { deleteEffect } from "./delete-effect.js";
import { skillInvocation } from "./invocation.js";

export { deleteEffect };

function homeDir() {
  return os.homedir();
}

// Quarantined skills live here, outside every drawer an agent reads.
// discoverRoots only adopts folders named skills or skill, so the cabinet
// cannot re-index its own quarantine as a live drawer.
export function quarantineRoot() {
  return path.join(homeDir(), ".skill-cabinet", "quarantine");
}

const SKIP_HOME_DOTDIRS = new Set([
  ".cache",
  ".local",
  ".npm",
  ".nvm",
  ".rustup",
  ".cargo",
  ".docker",
  ".mozilla",
  ".config",
  ".steam",
  ".var",
  ".wine",
  ".thumbnails",
  ".Trash",
  ".android",
  ".gradle",
  ".java",
  ".skill-cabinet",
]);

const SKIP_WALK = new Set([
  "node_modules",
  ".git",
  "dist",
  ".cache",
  "upstream",
]);

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

export function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function real(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function idFor(absPath) {
  return crypto.createHash("sha1").update(absPath).digest("hex").slice(0, 16);
}

const NAMED_SKILL_FILES = new Set(["skill.md", "SKILL.md"]);
const IGNORE_LOOSE_MD = new Set([
  "readme.md",
  "readme.es.md",
  "readme.ko.md",
  "changelog.md",
  "license.md",
  "licence.md",
  "description.md",
  "security.md",
  "contributing.md",
  "pull_request_template.md",
  "access.md",
  "benchmark.md",
]);

function isSkillFileName(name) {
  if (NAMED_SKILL_FILES.has(name)) return true;
  if (!/\.md$/i.test(name)) return false;
  return !IGNORE_LOOSE_MD.has(name.toLowerCase());
}

function findSkillFile(dir) {
  for (const name of ["SKILL.md", "skill.md"]) {
    const p = path.join(dir, name);
    if (exists(p) && !isDir(p)) return p;
  }
  return null;
}

function readLinkTarget(p) {
  try {
    return fs.readlinkSync(p);
  } catch {
    return "";
  }
}

function describeInstall(p) {
  let link = false;
  let file = false;
  let linkTarget = "";
  let dev = 0;
  let ino = 0;
  try {
    const listed = fs.lstatSync(p);
    link = listed.isSymbolicLink();
    if (link) {
      linkTarget = readLinkTarget(p);
      try {
        const followed = fs.statSync(p);
        file = followed.isFile();
        dev = followed.dev;
        ino = followed.ino;
      } catch {
        file = false;
      }
    } else {
      file = listed.isFile();
      dev = listed.dev;
      ino = listed.ino;
    }
  } catch {
    /* missing or unreadable */
  }
  return { link, file, linkTarget, dev, ino };
}

export function contained(child, parent) {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  return c === p || c.startsWith(p + path.sep);
}

function githubFromString(raw) {
  if (!raw) return null;
  const text = String(raw).trim().replace(/^["']|["']$/g, "");
  const match = text.match(
    /(?:https?:\/\/|git@|ssh:\/\/git@)github\.com[:/]+([^\s#?]+)/i,
  );
  if (match) {
    const parts = match[1]
      .replace(/\.git$/i, "")
      .split("/")
      .filter(Boolean);
    if (parts.length >= 2) {
      const spec = `${parts[0]}/${parts[1]}`;
      return {
        kind: "github",
        label: spec,
        url: `https://github.com/${spec}`,
      };
    }
  }
  if (/^[\w.-]+\/[\w.-]+$/.test(text)) {
    return {
      kind: "github",
      label: text,
      url: `https://github.com/${text}`,
    };
  }
  return null;
}

function originFromText(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const github = githubFromString(raw);
  if (github) return github;
  const text = raw.trim().replace(/^["']|["']$/g, "");
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    const label = `${parsed.host}${parsed.pathname}`.replace(/\/+$/, "");
    return { kind: "url", label, url: parsed.href };
  } catch {
    return null;
  }
}

function originFromValue(value) {
  if (typeof value === "string") return originFromText(value);
  if (value && typeof value === "object" && typeof value.url === "string") {
    return originFromText(value.url);
  }
  return null;
}

function withOrigin(origin, via, certainty) {
  if (!origin) return null;
  return { ...origin, via, certainty };
}

function originFromFrontmatter(data) {
  const meta =
    data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
      ? data.metadata
      : {};
  for (const key of ["source", "repository"]) {
    const found = originFromValue(data[key]) || originFromValue(meta[key]);
    if (found) return withOrigin(found, "frontmatter", "attested");
  }
  for (const key of ["homepage", "url"]) {
    const found = originFromValue(data[key]) || originFromValue(meta[key]);
    if (found?.kind === "github") {
      return withOrigin(found, "frontmatter", "attested");
    }
  }
  return null;
}

function originFromPath(p) {
  const norm = p.replace(/\\/g, "/");
  const market = norm.match(/\/marketplaces\/github\.com\/([^/]+)\/([^/]+)/);
  if (market) {
    return withOrigin(
      {
        kind: "github",
        label: `${market[1]}/${market[2]}`,
        url: `https://github.com/${market[1]}/${market[2]}`,
      },
      "path",
      "attested",
    );
  }
  const nested = norm.match(/\/github\.com\/([^/]+)\/([^/]+)/);
  if (nested && nested[1] !== "www") {
    return withOrigin(
      {
        kind: "github",
        label: `${nested[1]}/${nested[2]}`,
        url: `https://github.com/${nested[1]}/${nested[2]}`,
      },
      "path",
      "attested",
    );
  }
  return null;
}

function originFromPluginFile(file) {
  try {
    const st = fs.statSync(file, { throwIfNoEntry: false });
    if (!st || !st.isFile()) return null;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const repo = originFromValue(data.repository);
    if (repo) return repo;
    const home = originFromText(data.homepage);
    return home?.kind === "github" ? home : null;
  } catch {
    return null;
  }
}

function originFromGitDir(dir) {
  const gitPath = path.join(dir, ".git");
  try {
    const listed = fs.lstatSync(gitPath, { throwIfNoEntry: false });
    if (!listed) return null;
    let configPath = "";
    if (listed.isFile()) {
      const text = fs.readFileSync(gitPath, "utf8");
      const marker = text.match(/gitdir:\s*(.+)/i);
      if (!marker) return null;
      let gitdir = marker[1].trim();
      if (!path.isAbsolute(gitdir)) {
        gitdir = path.resolve(dir, gitdir);
      }
      configPath = path.join(gitdir, "config");
    } else if (listed.isDirectory()) {
      configPath = path.join(gitPath, "config");
    } else {
      return null;
    }
    const config = fs.readFileSync(configPath, "utf8");
    const url = config.match(/\[remote "origin"\][\s\S]*?url\s*=\s*(\S+)/);
    return url ? originFromText(url[1].replace(/^["']|["']$/g, "")) : null;
  } catch {
    return null;
  }
}

const PLUGIN_JSON = [
  ["plugin.json"],
  [".cursor-plugin", "plugin.json"],
  [".claude-plugin", "plugin.json"],
  [".plugin", "plugin.json"],
];

let originCache = new Map();

function originStartDir(start) {
  const resolved = path.resolve(start);
  try {
    const listed = fs.lstatSync(resolved);
    if (listed.isSymbolicLink()) {
      try {
        if (fs.statSync(resolved).isFile()) return path.dirname(resolved);
      } catch {
        return path.dirname(resolved);
      }
    }
    if (listed.isFile()) return path.dirname(resolved);
  } catch {
    /* missing */
  }
  return resolved;
}

function fromCachedOrigin(hit, startDir) {
  if (!hit) return null;
  const here = path.resolve(hit.at) === path.resolve(startDir);
  return withOrigin(hit.origin, hit.via, here ? "attested" : "inferred");
}

function originFromAncestors(start) {
  const chain = [];
  let current = originStartDir(start);
  const startDir = current;
  for (let i = 0; i < 14; i += 1) {
    if (originCache.has(current)) {
      const hit = originCache.get(current);
      for (const dir of chain) originCache.set(dir, hit);
      return fromCachedOrigin(hit, startDir);
    }
    chain.push(current);
    for (const parts of PLUGIN_JSON) {
      const found = originFromPluginFile(path.join(current, ...parts));
      if (found) {
        const packed = { origin: found, via: "plugin", at: current };
        for (const dir of chain) originCache.set(dir, packed);
        return fromCachedOrigin(packed, startDir);
      }
    }
    const git = originFromGitDir(current);
    if (git) {
      const packed = { origin: git, via: "git", at: current };
      for (const dir of chain) originCache.set(dir, packed);
      return fromCachedOrigin(packed, startDir);
    }
    const parent = path.dirname(current);
    if (parent === current || parent === homeDir()) break;
    current = parent;
  }
  for (const dir of chain) originCache.set(dir, null);
  return null;
}

function inferOrigin(dir, data, linkTarget) {
  const yaml = originFromFrontmatter(data);
  if (yaml) return yaml;
  const fromHere = originFromPath(dir);
  if (fromHere) return fromHere;
  if (linkTarget) {
    const resolved = path.isAbsolute(linkTarget)
      ? path.resolve(linkTarget)
      : path.resolve(path.dirname(dir), linkTarget);
    const fromLink = originFromPath(resolved) || originFromAncestors(resolved);
    if (fromLink) return fromLink;
  }
  return originFromAncestors(dir);
}

function parseFrontmatter(text) {
  if (!text.startsWith("---")) {
    return { data: {}, content: text, raw: "" };
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    return { data: {}, content: text, raw: "" };
  }
  const raw = text.slice(3, end).replace(/^\n/, "");
  let data = {};
  try {
    const parsed = YAML.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed;
    }
  } catch {
    data = { _parseError: "YAML frontmatter could not be parsed" };
  }
  const content = text.slice(end + 4).replace(/^\n/, "");
  return { data, content, raw };
}

function kindFor(root) {
  return root.kind;
}

export function discoverRoots() {
  const roots = [];
  const seen = new Set();

  const add = (scopeId, scopeLabel, root, kind, recursive = false, deep = false) => {
    if (!exists(root) || !isDir(root)) return;
    const resolved = real(root);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    roots.push({ scopeId, scopeLabel, root: resolved, kind, recursive, deep });
  };

  let homeEntries = [];
  try {
    homeEntries = fs.readdirSync(homeDir(), { withFileTypes: true });
  } catch {
    homeEntries = [];
  }

  for (const entry of homeEntries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (!entry.name.startsWith(".")) continue;
    if (SKIP_HOME_DOTDIRS.has(entry.name)) continue;

    const base = path.join(homeDir(), entry.name);
    const scopeId = entry.name.slice(1);

    for (const folder of ["skills", "skill"]) {
      // Drawers may nest skills by category (Hermes: skills/<category>/<skill>,
      // ghcp-appmod: skills/guidelines/<skill>), one level deeper than the
      // flat layout other tools use; deep collection handles both, the same
      // way the Hermes profile roots below already do.
      add(scopeId, entry.name, path.join(base, folder), "user", false, true);
    }

    if (entry.name === ".cursor") {
      add(
        "cursor-builtin",
        ".cursor/skills-cursor",
        path.join(base, "skills-cursor"),
        "builtin",
        false,
      );
      add(
        "cursor-plugins",
        ".cursor/plugins",
        path.join(base, "plugins"),
        "plugin",
        true,
      );
    }
  }

  add(
    "gemini",
    ".gemini/antigravity",
    path.join(homeDir(), ".gemini/antigravity/skills"),
    "user",
    false,
  );
  add(
    "gemini",
    ".gemini/antigravity (global)",
    path.join(homeDir(), ".gemini/antigravity/global_skills"),
    "user",
    false,
  );

  // Hermes keeps user skills in category subfolders
  // (skills/<category>/<skill>/SKILL.md) — already covered by the deep flag on
  // the generic drawer above — and plugin skills under plugins/<name>/skills/
  // plus some at plugin roots (ponytail ships both layouts). Scan the plugins
  // tree deep rather than recursive so both layouts are adopted; the bundled
  // hermes-agent checkout (skills/, optional-skills/) is not user state and
  // stays out of the cabinet.
  add(
    "hermes",
    ".hermes/plugins",
    path.join(homeDir(), ".hermes/plugins"),
    "plugin",
    false,
    true,
  );

  // Grok ships bundled skills next to its user drawer. The marketplace-cache
  // holds hashed checkouts of marketplace *catalogs* (xai plugin-marketplace,
  // anthropics claude-plugins-official), not installed plugins — nothing the
  // agent reads — so it is deliberately left out of the cabinet.
  add(
    "grok",
    ".grok/bundled",
    path.join(homeDir(), ".grok/bundled/skills"),
    "builtin",
    false,
  );

  // OpenCode loads plugins from its config directory (skills ship inside each
  // npm plugin package); node_modules is skipped by walkSkillContainers, so
  // the packages tree is adopted deep. Same for Antigravity plugin installs,
  // which live under .gemini/config/plugins, and the builtin/plugin skill sets
  // shipped by the Antigravity CLI and IDE.
  add(
    "opencode",
    ".config/opencode/node_modules",
    path.join(homeDir(), ".config/opencode/node_modules"),
    "plugin",
    false,
    true,
  );
  add(
    "gemini",
    ".gemini/config/plugins",
    path.join(homeDir(), ".gemini/config/plugins"),
    "plugin",
    false,
    true,
  );
  add(
    "gemini",
    ".gemini/antigravity-cli (builtin)",
    path.join(homeDir(), ".gemini/antigravity-cli/builtin/skills"),
    "builtin",
    false,
  );
  add(
    "gemini",
    ".gemini/antigravity-ide (builtin)",
    path.join(homeDir(), ".gemini/antigravity-ide/builtin/skills"),
    "builtin",
    false,
  );
  add(
    "gemini",
    ".gemini/antigravity-ide/plugins",
    path.join(homeDir(), ".gemini/antigravity-ide/plugins"),
    "plugin",
    false,
    true,
  );

  // mimo Code caches builtin skills per version under its XDG data dir.
  add(
    "mimo",
    "mimocode builtin",
    path.join(homeDir(), ".local/share/mimocode/builtin_skills"),
    "builtin",
    false,
    true,
  );

  const hermesProfiles = path.join(homeDir(), ".hermes", "profiles");
  let profileEntries = [];
  try {
    profileEntries = fs.readdirSync(hermesProfiles, { withFileTypes: true });
  } catch {
    profileEntries = [];
  }
  for (const entry of profileEntries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith(".")) continue;
    add(
      `hermes-profile:${entry.name}`,
      `Hermes profile · ${entry.name}`,
      path.join(hermesProfiles, entry.name, "skills"),
      "user",
      false,
      true,
    );
  }

  let quarantineScopes = [];
  try {
    quarantineScopes = fs.readdirSync(quarantineRoot(), { withFileTypes: true });
  } catch {
    quarantineScopes = [];
  }
  for (const entry of quarantineScopes) {
    if (!entry.isDirectory()) continue;
    const folder = path.join(quarantineRoot(), entry.name);
    if (!exists(folder) || !isDir(folder)) continue;
    const resolved = real(folder);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    roots.push({
      scopeId: "quarantine",
      scopeLabel: "Quarantine",
      root: resolved,
      kind: "quarantine",
      recursive: false,
      fromScope: entry.name,
    });
  }

  return roots;
}

function collectDirectSkills(root, list, nested = false, depth = 0) {
  if (nested && depth > 14) return;
  let entries;
  try {
    entries = fs.readdirSync(root.root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_WALK.has(entry.name)) continue;
    const abs = path.resolve(path.join(root.root, entry.name));
    const install = describeInstall(abs);
    if (install.link && !install.file && !isDir(abs)) {
      list.push({
        dir: abs,
        skillMd: abs,
        root,
        ...install,
        file: false,
        dangling: true,
      });
      continue;
    }
    if (isDir(abs)) {
      const skillMd = findSkillFile(abs);
      if (skillMd) {
        list.push({ dir: abs, skillMd, root, ...install, file: false });
      } else if (nested) {
        collectDirectSkills({ ...root, root: abs }, list, true, depth + 1);
      }
      continue;
    }
    if (install.file && isSkillFileName(entry.name)) {
      list.push({
        dir: abs,
        skillMd: abs,
        root,
        ...install,
        file: true,
      });
    }
  }
}

function walkSkillContainers(dir, root, list, depth = 0) {
  if (depth > 14) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  const base = path.basename(dir);
  if (base === "skills" || base === "skill") {
    collectDirectSkills({ ...root, root: dir }, list);
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (SKIP_WALK.has(entry.name)) continue;
    walkSkillContainers(path.join(dir, entry.name), root, list, depth + 1);
  }
}

function dirSizeAndFiles(dir) {
  try {
    const followed = fs.statSync(dir);
    if (followed.isFile()) {
      return {
        files: [
          {
            path: path.basename(dir),
            size: followed.size,
            mtime: followed.mtimeMs,
          },
        ],
        bytes: followed.size,
      };
    }
  } catch {
    /* walk as a directory when we can */
  }
  const files = [];
  let bytes = 0;
  const walk = (current, rel, depth) => {
    if (depth > 8 || files.length > 250) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_WALK.has(entry.name)) continue;
      const abs = path.join(current, entry.name);
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(abs, nextRel, depth + 1);
      } else if (entry.isFile()) {
        let size = 0;
        let mtime = 0;
        try {
          const st = fs.statSync(abs);
          size = st.size;
          mtime = st.mtimeMs;
          bytes += size;
        } catch {
          /* ignore */
        }
        files.push({ path: nextRel, size, mtime });
      }
    }
  };
  walk(dir, "", 0);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, bytes };
}

function danglingSummary(item) {
  const { dir, root } = item;
  let mtime = 0;
  try {
    mtime = fs.lstatSync(dir).mtimeMs;
  } catch {
    /* gone */
  }
  const base = path.basename(dir);
  const slug = base.replace(/\.md$/i, "");
  return {
    id: idFor(dir),
    name: slug,
    slug,
    description: "",
    frontmatter: {},
    scopeId: root.scopeId,
    scopeLabel: root.scopeLabel,
    kind: kindFor(root),
    path: dir,
    skillFile: dir,
    skillRel: path.basename(dir),
    file: false,
    link: true,
    linkTarget: item.linkTarget || "",
    origin: null,
    invocation: "model",
    invocationEvidence: "",
    contentHash: null,
    risk: "none",
    findings: [],
    copies: [],
    mtime,
    skillSize: 0,
    physicality: "broken",
    refTarget: "",
    refSkillId: "",
    quarantined: root.kind === "quarantine",
    fromScope: root.fromScope || "",
  };
}

function summarizeSkill(item, memo, realpaths) {
  const { dir, skillMd, root } = item;
  if (item.dangling) return danglingSummary(item);
  const identity = item.dev || item.ino ? `${item.dev}:${item.ino}` : real(dir);
  const memoKey = `${identity}|${item.file ? "file" : "dir"}`;
  let shared = memo.get(memoKey);
  if (!shared) {
    let mtime = 0;
    let size = 0;
    let raw;
    try {
      const st = fs.statSync(skillMd);
      mtime = st.mtimeMs;
      size = st.size;
      raw = fs.readFileSync(skillMd);
    } catch {
      return null;
    }
    const text = raw.toString("utf8");
    const { data } = parseFrontmatter(text);
    shared = {
      data,
      mtime,
      size,
      contentHash: crypto.createHash("sha256").update(raw).digest("hex"),
      audited: auditSkill({
        root: dir,
        skillFile: skillMd,
        text,
        fileOnly: Boolean(item.file),
      }),
    };
    memo.set(memoKey, shared);
  }
  let refTarget = "";
  if (item.link) {
    refTarget = realpaths.get(identity) || "";
    if (!refTarget) {
      refTarget = real(dir);
      realpaths.set(identity, refTarget);
    }
  }
  const base = path.basename(dir);
  const slug = item.file ? base.replace(/\.md$/i, "") : base;
  const name =
    (typeof shared.data.name === "string" && shared.data.name) ||
    (typeof shared.data.displayName === "string" && shared.data.displayName) ||
    slug;
  const description =
    typeof shared.data.description === "string" ? shared.data.description : "";
  const when = skillInvocation({
    skillDir: dir,
    fileOnly: Boolean(item.file),
    frontmatter: shared.data,
    description,
  });

  return {
    id: idFor(dir),
    name,
    slug,
    description,
    frontmatter: shared.data,
    scopeId: root.scopeId,
    scopeLabel: root.scopeLabel,
    kind: kindFor(root),
    path: dir,
    skillFile: skillMd,
    skillRel: path.basename(skillMd),
    file: Boolean(item.file),
    link: Boolean(item.link),
    linkTarget: item.linkTarget || "",
    origin: inferOrigin(dir, shared.data, item.linkTarget),
    invocation: when.invocation,
    invocationEvidence: when.invocationEvidence,
    contentHash: shared.contentHash,
    risk: shared.audited.severity,
    findings: shared.audited.findings.slice(),
    copies: [],
    mtime: shared.mtime,
    skillSize: shared.size,
    physicality: item.link ? "reference" : "physical",
    refTarget,
    refSkillId: "",
    quarantined: root.kind === "quarantine",
    fromScope: root.fromScope || "",
  };
}

export function attachCopies(skills) {
  const byHash = new Map();
  for (const skill of skills) {
    if (skill.physicality !== "physical") continue;
    if (!skill.contentHash) continue;
    const list = byHash.get(skill.contentHash) || [];
    list.push(skill);
    byHash.set(skill.contentHash, list);
  }
  for (const skill of skills) {
    if (skill.physicality !== "physical") {
      skill.copies = [];
      continue;
    }
    const group = byHash.get(skill.contentHash) || [];
    skill.copies = group
      .filter((other) => other.id !== skill.id)
      .map((other) => ({
        id: other.id,
        scopeLabel: other.scopeLabel,
        path: other.path,
      }));
  }
  return skills;
}

export function scanRoots(roots) {
  originCache = new Map();
  const memo = new Map();
  const realpaths = new Map();
  const found = [];
  for (const root of roots) {
    if (root.deep) {
      collectDirectSkills(root, found, true);
    } else if (root.recursive) {
      walkSkillContainers(root.root, root, found);
    } else {
      collectDirectSkills(root, found);
    }
  }

  const byPath = new Map();
  for (const item of found) {
    byPath.set(item.dir, item);
  }

  const skills = [];
  const byId = new Map();
  for (const item of byPath.values()) {
    const summary = summarizeSkill(item, memo, realpaths);
    if (!summary) continue;
    skills.push(summary);
    byId.set(summary.id, summary);
  }

  const byReal = new Map();
  for (const skill of skills) {
    if (skill.physicality === "physical") byReal.set(real(skill.path), skill.id);
  }
  for (const skill of skills) {
    if (skill.physicality === "reference") {
      skill.refSkillId = byReal.get(skill.refTarget) || "";
    }
  }

  attachCopies(skills);

  skills.sort((a, b) => {
    const scope = a.scopeLabel.localeCompare(b.scopeLabel);
    if (scope !== 0) return scope;
    return a.name.localeCompare(b.name);
  });

  return { roots, skills, byId, census: censusOf(skills) };
}

export function scanSkills() {
  return scanRoots(discoverRoots());
}

function censusOf(skills) {
  const live = skills.filter((skill) => !skill.quarantined);
  const physical = live.filter((skill) => skill.physicality === "physical");
  const byHash = new Map();
  for (const skill of physical) {
    if (!skill.contentHash) continue;
    byHash.set(skill.contentHash, (byHash.get(skill.contentHash) || 0) + 1);
  }
  let duplicateCopies = 0;
  let duplicateBytes = 0;
  for (const skill of physical) {
    const twins = byHash.get(skill.contentHash) || 1;
    if (twins > 1) {
      duplicateCopies += 1;
      duplicateBytes += dirSizeAndFiles(skill.path).bytes;
    }
  }
  return {
    total: live.length,
    physical: physical.length,
    unique: byHash.size,
    duplicateCopies,
    duplicateBytes,
    references: live.filter((skill) => skill.physicality === "reference")
      .length,
    broken: live.filter((skill) => skill.physicality === "broken").length,
    duplicates: duplicateCopies,
  };
}

export function toCatalogSkill(skill) {
  return {
    id: skill.id,
    name: skill.name,
    slug: skill.slug,
    description: skill.description,
    scopeId: skill.scopeId,
    scopeLabel: skill.scopeLabel,
    kind: skill.kind,
    path: skill.path,
    skillRel: skill.skillRel,
    file: skill.file,
    link: skill.link,
    linkTarget: skill.linkTarget,
    origin: skill.origin,
    invocation: skill.invocation,
    invocationEvidence: skill.invocationEvidence,
    risk: skill.risk,
    physicality: skill.physicality,
    refTarget: skill.refTarget,
    refSkillId: skill.refSkillId,
    copyCount: skill.copies.length,
    copies: skill.copies,
    mtime: skill.mtime,
    quarantined: Boolean(skill.quarantined),
    fromScope: skill.fromScope || "",
  };
}

export function readSkill(summary) {
  if (summary.physicality === "broken") {
    return {
      ...summary,
      frontmatter: {},
      frontmatterRaw: "",
      body: "",
      source: "",
      files: [],
      bytes: 0,
    };
  }
  const text = fs.readFileSync(summary.skillFile, "utf8");
  const { data, content, raw } = parseFrontmatter(text);
  const { files, bytes } = dirSizeAndFiles(summary.path);
  return {
    ...summary,
    frontmatter: data,
    frontmatterRaw: raw,
    body: content,
    source: text,
    files,
    bytes,
  };
}

export function readSkillFile(summary, relPath) {
  if (summary.file) {
    const abs = real(summary.skillFile);
    const st = fs.statSync(abs);
    if (st.size > 1_500_000) {
      const err = new Error("File too large to preview");
      err.status = 413;
      throw err;
    }
    const buf = fs.readFileSync(abs);
    return {
      path: path.basename(summary.skillFile),
      size: st.size,
      binary: false,
      content: buf.toString("utf8"),
    };
  }
  const normalized = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const abs = real(path.join(summary.path, normalized));
  const root = real(summary.path);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    const err = new Error("Path escapes skill directory");
    err.status = 400;
    throw err;
  }
  if (!exists(abs) || isDir(abs)) {
    const err = new Error("File not found");
    err.status = 404;
    throw err;
  }
  const st = fs.statSync(abs);
  if (st.size > 1_500_000) {
    const err = new Error("File too large to preview");
    err.status = 413;
    throw err;
  }
  const buf = fs.readFileSync(abs);
  const looksText =
    !buf.includes(0) &&
    /\.(md|txt|ya?ml|json|js|mjs|cjs|ts|tsx|jsx|py|sh|html|css|svg|toml|xml|csv|rst)$/i.test(
      abs,
    );
  return {
    path: path.relative(root, abs),
    size: st.size,
    binary: !looksText,
    content: looksText ? buf.toString("utf8") : null,
  };
}

export function assertSkillTarget(summary, roots, action = "delete") {
  const target = path.resolve(summary.path);
  const ok = roots.some((r) => contained(target, r.root) && path.resolve(r.root) !== target);
  if (!ok || target === homeDir()) {
    const err = new Error(
      ok
        ? `Refusing to ${action} a cabinet root`
        : "Skill is outside known cabinet roots",
    );
    err.status = 403;
    throw err;
  }
  const install = describeInstall(target);
  const isDeadLink = install.link && !install.file && !isDir(target);
  const isFolderSkill = isDir(target) && findSkillFile(target);
  const isFileSkill = install.file && isSkillFileName(path.basename(target));
  if (!isDeadLink && !isFolderSkill && !isFileSkill) {
    const err = new Error("Not a skill path");
    err.status = 400;
    throw err;
  }
  return target;
}

export function assertDeletable(summary, roots) {
  return assertSkillTarget(summary, roots, "delete");
}

export function deleteSkillDir(target) {
  const st = fs.lstatSync(target);
  if (st.isSymbolicLink() || st.isFile()) {
    fs.unlinkSync(target);
    return;
  }
  fs.rmSync(target, { recursive: true, force: false });
}
