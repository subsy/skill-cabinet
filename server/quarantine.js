import fs from "node:fs";
import path from "node:path";
import {
  quarantineRoot,
  assertSkillTarget,
  contained,
  isDir,
} from "./scan.js";

function manifestPath() {
  return path.join(quarantineRoot(), "quarantine.json");
}

function fail(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function occupied(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

export function readManifest() {
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath(), "utf8"));
  } catch {
    parsed = null;
  }
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  return {
    version: 1,
    entries: entries.filter(
      (entry) =>
        entry &&
        typeof entry.quarantinePath === "string" &&
        typeof entry.originPath === "string" &&
        occupied(entry.quarantinePath),
    ),
  };
}

function writeManifest(manifest) {
  fs.mkdirSync(quarantineRoot(), { recursive: true });
  const dest = manifestPath();
  const tmp = `${dest}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(
      tmp,
      `${JSON.stringify({ version: 1, entries: manifest.entries }, null, 2)}\n`,
      "utf8",
    );
    fs.renameSync(tmp, dest);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* leave the tmp */
    }
    throw err;
  }
}

function scopeFolder(scopeId) {
  const cleaned = String(scopeId || "loose").replace(/[^A-Za-z0-9._-]+/g, "-");
  return cleaned === "." || cleaned === ".." || !cleaned ? "loose" : cleaned;
}

function withSuffix(base, n) {
  const ext = path.extname(base);
  return ext ? `${base.slice(0, -ext.length)}-${n}${ext}` : `${base}-${n}`;
}

function freeQuarantinePath(scopeDir, base) {
  let candidate = path.join(scopeDir, base);
  for (let n = 2; occupied(candidate) && n < 1000; n += 1) {
    candidate = path.join(scopeDir, withSuffix(base, n));
  }
  if (occupied(candidate)) {
    throw fail("Too many quarantined copies under that name", 409);
  }
  return candidate;
}

function move(source, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(source, dest);
    return;
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
  }
  fs.cpSync(source, dest, { recursive: true, verbatimSymlinks: true });
  fs.rmSync(source, { recursive: true, force: true });
}

function persistAfterMove(from, to, persist) {
  try {
    persist();
  } catch (err) {
    try {
      move(to, from);
    } catch {
      /* the copy now lives only at to */
    }
    throw err;
  }
}

function pruneScopeDir(dir) {
  const resolved = path.resolve(dir);
  if (resolved === path.resolve(quarantineRoot())) return;
  if (!contained(resolved, quarantineRoot())) return;
  try {
    if (fs.readdirSync(resolved).length === 0) fs.rmdirSync(resolved);
  } catch {
    /* leave it in place */
  }
}

export function quarantineSkill(summary, roots) {
  if (summary.quarantined) {
    throw fail("Already in the quarantine", 400);
  }
  const source = assertSkillTarget(summary, roots, "quarantine");
  const scopeDir = path.join(quarantineRoot(), scopeFolder(summary.scopeId));
  const dest = freeQuarantinePath(scopeDir, path.basename(source));

  move(source, dest);
  persistAfterMove(source, dest, () => {
    const manifest = readManifest();
    manifest.entries = manifest.entries.filter(
      (entry) => path.resolve(entry.quarantinePath) !== path.resolve(dest),
    );
    manifest.entries.push({
      quarantinePath: dest,
      originPath: source,
      name: summary.name,
      slug: summary.slug,
      scopeId: summary.scopeId,
      scopeLabel: summary.scopeLabel,
      kind: summary.kind,
      file: Boolean(summary.file),
      link: Boolean(summary.link),
      quarantinedAt: Date.now(),
    });
    writeManifest(manifest);
  });

  return { from: source, to: dest };
}

export function restoreSkill(summary, roots) {
  const source = path.resolve(summary.path);
  if (!summary.quarantined || !contained(source, quarantineRoot())) {
    throw fail("Not a quarantined card", 400);
  }

  const manifest = readManifest();
  const entry = manifest.entries.find(
    (item) => path.resolve(item.quarantinePath) === source,
  );
  if (!entry) {
    throw fail(
      "No quarantine record says where this came from. Move it back by hand.",
      409,
    );
  }

  const dest = path.resolve(entry.originPath);
  const drawers = roots.filter((root) => root.kind !== "quarantine");
  const insideDrawer = drawers.some(
    (root) => contained(dest, root.root) && path.resolve(root.root) !== dest,
  );
  if (!insideDrawer) {
    throw fail(`No cabinet drawer holds ${dest} any more`, 403);
  }
  if (!isDir(path.dirname(dest))) {
    throw fail(`The original drawer is gone: ${path.dirname(dest)}`, 409);
  }
  if (occupied(dest)) {
    throw fail(`Something is already at ${dest}`, 409);
  }

  move(source, dest);
  persistAfterMove(source, dest, () => {
    manifest.entries = manifest.entries.filter(
      (item) => path.resolve(item.quarantinePath) !== source,
    );
    writeManifest(manifest);
    pruneScopeDir(path.dirname(source));
  });

  return { from: source, to: dest };
}

export function quarantineRecordFor(quarantinePath) {
  const target = path.resolve(quarantinePath);
  return (
    readManifest().entries.find(
      (entry) => path.resolve(entry.quarantinePath) === target,
    ) || null
  );
}

export function forgetQuarantinePath(target) {
  const resolved = path.resolve(target);
  if (!contained(resolved, quarantineRoot())) return;
  const manifest = readManifest();
  const next = manifest.entries.filter(
    (entry) => path.resolve(entry.quarantinePath) !== resolved,
  );
  if (next.length === manifest.entries.length) return;
  writeManifest({ ...manifest, entries: next });
  pruneScopeDir(path.dirname(resolved));
}
