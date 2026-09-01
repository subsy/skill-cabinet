import fs from "node:fs";
import path from "node:path";
import {
  ARCHIVE_ROOT,
  assertSkillTarget,
  contained,
  isDir,
} from "./scan.js";

const MANIFEST = path.join(ARCHIVE_ROOT, "archive.json");

function fail(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// lstat, not existsSync: a broken symlink still occupies the name, and
// existsSync answers false for one. Overwriting a dead link would silently
// destroy whatever the archive already held under that name.
function occupied(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

// The manifest records only what the filesystem cannot: where each archived
// card came from. Entries whose folder is gone (deleted straight out of the
// archive) are dropped on read, so a stale record can never send a restore
// somewhere unexpected. The tidied list is written back by the next archive or
// restore, not by the read itself.
export function readManifest() {
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  } catch {
    parsed = null;
  }
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
  return {
    version: 1,
    entries: entries.filter(
      (entry) =>
        entry &&
        typeof entry.archivePath === "string" &&
        typeof entry.originPath === "string" &&
        occupied(entry.archivePath),
    ),
  };
}

function writeManifest(manifest) {
  fs.mkdirSync(ARCHIVE_ROOT, { recursive: true });
  fs.writeFileSync(
    MANIFEST,
    `${JSON.stringify({ version: 1, entries: manifest.entries }, null, 2)}\n`,
    "utf8",
  );
}

// Scope ids come from directory names on disk, so they are treated as untrusted
// here: one folder name, no separators, nothing that could climb out of the
// archive root.
function scopeFolder(scopeId) {
  const cleaned = String(scopeId || "loose").replace(/[^A-Za-z0-9._-]+/g, "-");
  return cleaned === "." || cleaned === ".." || !cleaned ? "loose" : cleaned;
}

function withSuffix(base, n) {
  const ext = path.extname(base);
  return ext ? `${base.slice(0, -ext.length)}-${n}${ext}` : `${base}-${n}`;
}

// Archiving the same slug twice keeps both copies rather than overwriting the
// older one: the earlier archive is the copy the user asked to keep.
function freeArchivePath(scopeDir, base) {
  let candidate = path.join(scopeDir, base);
  for (let n = 2; occupied(candidate) && n < 1000; n += 1) {
    candidate = path.join(scopeDir, withSuffix(base, n));
  }
  if (occupied(candidate)) {
    throw fail("Too many archived copies under that name", 409);
  }
  return candidate;
}

// rename is the operation that makes this reversible: it is atomic, and it moves
// a symlink AS a link rather than following it, so archiving a linked skill
// never touches the repository the link points at. The copy fallback exists only
// for a cross-device archive root, and keeps links verbatim for the same reason.
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

function pruneScopeDir(dir) {
  const resolved = path.resolve(dir);
  if (resolved === path.resolve(ARCHIVE_ROOT)) return;
  if (!contained(resolved, ARCHIVE_ROOT)) return;
  try {
    if (fs.readdirSync(resolved).length === 0) fs.rmdirSync(resolved);
  } catch {
    /* leave it in place */
  }
}

export function archiveSkill(summary, roots) {
  if (summary.archived) {
    throw fail("Already in the archive", 400);
  }
  const source = assertSkillTarget(summary, roots, "archive");
  const scopeDir = path.join(ARCHIVE_ROOT, scopeFolder(summary.scopeId));
  const dest = freeArchivePath(scopeDir, path.basename(source));

  move(source, dest);

  const manifest = readManifest();
  manifest.entries = manifest.entries.filter(
    (entry) => path.resolve(entry.archivePath) !== path.resolve(dest),
  );
  manifest.entries.push({
    archivePath: dest,
    originPath: source,
    name: summary.name,
    slug: summary.slug,
    scopeId: summary.scopeId,
    scopeLabel: summary.scopeLabel,
    kind: summary.kind,
    file: Boolean(summary.file),
    link: Boolean(summary.link),
    archivedAt: Date.now(),
  });
  writeManifest(manifest);

  return { from: source, to: dest };
}

export function restoreSkill(summary, roots) {
  const source = path.resolve(summary.path);
  if (!summary.archived || !contained(source, ARCHIVE_ROOT)) {
    throw fail("Not an archived card", 400);
  }

  const manifest = readManifest();
  const entry = manifest.entries.find(
    (item) => path.resolve(item.archivePath) === source,
  );
  if (!entry) {
    throw fail(
      "No archive record says where this came from. Move it back by hand.",
      409,
    );
  }

  // Restoring never removes a drawer, so the roots captured at the start of a
  // batch stay correct for every card in it. One scan, not one per card.
  const dest = path.resolve(entry.originPath);
  const drawers = roots.filter((root) => root.kind !== "archive");
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

  manifest.entries = manifest.entries.filter(
    (item) => path.resolve(item.archivePath) !== source,
  );
  writeManifest(manifest);
  pruneScopeDir(path.dirname(source));

  return { from: source, to: dest };
}

// What the reading desk needs to promise a restore: the exact path this card
// would go back to. Read from the manifest, so a card whose record is gone
// honestly shows nothing rather than a guess.
export function archiveRecordFor(archivePath) {
  const target = path.resolve(archivePath);
  return (
    readManifest().entries.find(
      (entry) => path.resolve(entry.archivePath) === target,
    ) || null
  );
}
