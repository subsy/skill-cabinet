import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import YAML from "yaml";

const HOME = os.homedir();
const QUARANTINE_DIR_NAME = ".skill-cabinet-quarantine";

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

function isDir(p) {
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

function findSkillFile(dir) {
  for (const name of ["SKILL.md", "skill.md"]) {
    const p = path.join(dir, name);
    try {
      if (fs.lstatSync(p).isFile()) return p;
    } catch {
      /* ignore unreadable or missing files */
    }
  }
  return null;
}

function contained(child, parent) {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  return c === p || c.startsWith(p + path.sep);
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

export function discoverRoots(home = HOME) {
  const roots = [];
  const seen = new Set();

  const add = (
    scopeId,
    scopeLabel,
    root,
    kind,
    recursive = false,
    profileName,
  ) => {
    if (!exists(root) || !isDir(root)) return;
    const resolved = real(root);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    roots.push({
      scopeId,
      scopeLabel,
      root: resolved,
      kind,
      recursive,
      profileName,
    });
  };

  let homeEntries = [];
  try {
    homeEntries = fs.readdirSync(home, { withFileTypes: true });
  } catch {
    homeEntries = [];
  }

  for (const entry of homeEntries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (!entry.name.startsWith(".")) continue;
    if (SKIP_HOME_DOTDIRS.has(entry.name)) continue;

    const base = path.join(home, entry.name);
    const scopeId = entry.name.slice(1);

    for (const folder of ["skills", "skill"]) {
      add(scopeId, entry.name, path.join(base, folder), "user", false);
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
    path.join(home, ".gemini/antigravity/skills"),
    "user",
    false,
  );
  add(
    "gemini",
    ".gemini/antigravity (global)",
    path.join(home, ".gemini/antigravity/global_skills"),
    "user",
    false,
  );

  const hermesProfiles = path.join(home, ".hermes", "profiles");
  let profileEntries = [];
  try {
    profileEntries = fs.readdirSync(hermesProfiles, { withFileTypes: true });
  } catch {
    profileEntries = [];
  }
  for (const entry of profileEntries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    add(
      `hermes-profile:${entry.name}`,
      `Hermes profile · ${entry.name}`,
      path.join(hermesProfiles, entry.name, "skills"),
      "profile",
      true,
      entry.name,
    );
  }

  return roots;
}

function collectDirectSkills(root, list) {
  let entries;
  try {
    entries = fs.readdirSync(root.root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_WALK.has(entry.name)) continue;
    const dir = path.resolve(path.join(root.root, entry.name));
    const skillMd = findSkillFile(dir);
    if (skillMd) {
      list.push({ dir, skillMd, root });
    }
  }
}

function walkSkillContainers(dir, root, list, depth = 0) {
  if (depth > 14) return;
  const skillMd = findSkillFile(dir);
  if (skillMd) {
    list.push({ dir, skillMd, root });
    return;
  }
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_WALK.has(entry.name)) continue;
    walkSkillContainers(path.join(dir, entry.name), root, list, depth + 1);
  }
}

function dirSizeAndFiles(dir) {
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

function summarizeSkill(dir, skillMd, root) {
  let text = "";
  let mtime = 0;
  let size = 0;
  try {
    const st = fs.statSync(skillMd);
    mtime = st.mtimeMs;
    size = st.size;
    text = fs.readFileSync(skillMd, "utf8");
  } catch {
    return null;
  }
  const { data } = parseFrontmatter(text);
  const slug = path.basename(dir);
  const name =
    (typeof data.name === "string" && data.name) ||
    (typeof data.displayName === "string" && data.displayName) ||
    slug;
  const description =
    typeof data.description === "string" ? data.description : "";

  return {
    id: idFor(dir),
    name,
    slug,
    description,
    frontmatter: data,
    scopeId: root.scopeId,
    scopeLabel: root.scopeLabel,
    kind: kindFor(root),
    profileName: root.profileName,
    path: dir,
    skillFile: skillMd,
    mtime,
    skillSize: size,
  };
}

export function scanSkills(home = HOME) {
  const roots = discoverRoots(home);
  const found = [];
  for (const root of roots) {
    if (root.recursive) {
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
    const summary = summarizeSkill(item.dir, item.skillMd, item.root);
    if (!summary) continue;
    skills.push(summary);
    byId.set(summary.id, summary);
  }

  skills.sort((a, b) => {
    const scope = a.scopeLabel.localeCompare(b.scopeLabel);
    if (scope !== 0) return scope;
    return a.name.localeCompare(b.name);
  });

  return { roots, skills, byId };
}

export function readSkill(summary) {
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
  const st = fs.lstatSync(abs);
  if (st.isSymbolicLink()) {
    const err = new Error("Symbolic links are not previewable");
    err.status = 400;
    throw err;
  }
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

export function assertDeletable(summary, roots, home = HOME) {
  const target = path.resolve(summary.path);
  const ok = roots.some((r) => contained(target, r.root) && path.resolve(r.root) !== target);
  if (!ok || target === path.resolve(home)) {
    const err = new Error(
      ok
        ? "Refusing to delete a cabinet root"
        : "Skill is outside known cabinet roots",
    );
    err.status = 403;
    throw err;
  }
  if (!findSkillFile(target)) {
    const err = new Error("Not a skill directory");
    err.status = 400;
    throw err;
  }
  return target;
}

export function quarantineSkillDir(summary, home = HOME) {
  const target = path.resolve(summary.path);
  const quarantineRoot = path.join(home, QUARANTINE_DIR_NAME);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const entryDir = path.join(
    quarantineRoot,
    `${stamp}--${summary.id}--${path.basename(target)}`,
  );
  const destination = path.join(entryDir, "skill");

  const targetStat = fs.lstatSync(target);
  if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) {
    const err = new Error("Only real skill directories can be quarantined");
    err.status = 400;
    throw err;
  }

  fs.mkdirSync(quarantineRoot, { recursive: true });
  fs.mkdirSync(entryDir, { recursive: false });
  try {
    fs.writeFileSync(
      path.join(entryDir, "manifest.json"),
      `${JSON.stringify(
        {
          name: summary.name,
          originalPath: target,
          scopeLabel: summary.scopeLabel,
          profileName: summary.profileName ?? null,
          quarantinedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    fs.renameSync(target, destination);
  } catch (err) {
    fs.rmSync(entryDir, { recursive: true, force: true });
    throw err;
  }
  return { path: entryDir, skillPath: destination };
}
