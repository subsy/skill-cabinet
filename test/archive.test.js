import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// scan.js reads the home directory once, at import. Pointing HOME and
// USERPROFILE at a scratch tree before that first import is what lets these
// tests move real files around without touching the operator's own drawers.
const HOME = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "skill-cabinet-test-")),
);
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

const { scanSkills, ARCHIVE_ROOT } = await import("../server/scan.js");
const { archiveSkill, restoreSkill, readManifest } = await import(
  "../server/archive.js"
);

test.after(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
});

function writeSkill(dir, name, body = "does a thing") {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${body}\n---\n\n# ${name}\n`,
    "utf8",
  );
  return dir;
}

function drawer(scope) {
  const dir = path.join(HOME, scope, "skills");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cardAt(target) {
  const index = scanSkills();
  const skill = index.skills.find(
    (s) => path.resolve(s.path) === path.resolve(target),
  );
  return { index, skill };
}

function occupied(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

// Windows refuses real symlinks without Developer Mode, but a junction is the
// same kind of reparse point for our purposes: lstat reports it as a link, and
// moving it must move the link rather than copy the tree behind it. Fall back to
// one so this case is actually exercised instead of quietly skipped.
function linkKind() {
  for (const kind of ["dir", "junction"]) {
    const probe = path.join(HOME, `.link-probe-${kind}`);
    try {
      fs.symlinkSync(HOME, probe, kind);
      const ok = fs.lstatSync(probe).isSymbolicLink();
      fs.unlinkSync(probe);
      if (ok) return kind;
    } catch {
      /* try the next kind */
    }
  }
  return null;
}

const LINK_KIND = linkKind();

test("archive moves a skill out of its drawer and into the archive", () => {
  const origin = writeSkill(path.join(drawer(".claude"), "alpha"), "alpha");
  const { index, skill } = cardAt(origin);
  assert.ok(skill, "the skill should be indexed before archiving");
  assert.equal(skill.archived, false);

  const moved = archiveSkill(skill, index.roots);

  assert.equal(occupied(origin), false, "the drawer copy must be gone");
  assert.ok(
    moved.to.startsWith(ARCHIVE_ROOT),
    `archived to ${moved.to}, expected it under ${ARCHIVE_ROOT}`,
  );
  assert.equal(
    fs.readFileSync(path.join(moved.to, "SKILL.md"), "utf8").includes("alpha"),
    true,
    "the archived copy must keep its contents",
  );

  const after = scanSkills();
  const archived = after.skills.find(
    (s) => path.resolve(s.path) === path.resolve(moved.to),
  );
  assert.ok(archived, "the archived card should still be readable");
  assert.equal(archived.archived, true);
  assert.equal(archived.scopeId, "archive");
  assert.equal(archived.fromScope, "claude", "it should remember its drawer");
  assert.equal(archived.name, "alpha", "frontmatter should still parse");
});

test("an archived skill is never indexed as a live drawer", () => {
  const origin = writeSkill(path.join(drawer(".codex"), "bravo"), "bravo");
  const { index, skill } = cardAt(origin);
  archiveSkill(skill, index.roots);

  const after = scanSkills();
  const live = after.skills.filter((s) => !s.archived);
  assert.equal(
    live.some((s) => s.name === "bravo"),
    false,
    "an archived skill must not appear in any live drawer",
  );
  assert.equal(
    after.roots.some((r) => r.kind !== "archive" && r.root.includes(".skill-cabinet")),
    false,
    "the archive must never register as a live root",
  );
});

test("restore puts the skill back at its exact original path", () => {
  const origin = writeSkill(path.join(drawer(".agents"), "charlie"), "charlie");
  const first = cardAt(origin);
  const moved = archiveSkill(first.skill, first.index.roots);
  assert.equal(occupied(origin), false);

  const second = cardAt(moved.to);
  const back = restoreSkill(second.skill, second.index.roots);

  assert.equal(path.resolve(back.to), path.resolve(origin));
  assert.equal(occupied(origin), true, "the skill must be back in its drawer");
  assert.equal(occupied(moved.to), false, "the archive copy must be gone");
  assert.equal(
    readManifest().entries.some((e) => e.archivePath === moved.to),
    false,
    "the manifest entry must be cleared on restore",
  );

  const after = scanSkills();
  const live = after.skills.find(
    (s) => path.resolve(s.path) === path.resolve(origin),
  );
  assert.ok(live, "the restored skill should be indexed again");
  assert.equal(live.archived, false);
  assert.equal(live.scopeId, "agents");
});

test("restore refuses an occupied path and keeps the archived copy", () => {
  const origin = writeSkill(path.join(drawer(".claude"), "delta"), "delta");
  const { index, skill } = cardAt(origin);
  const moved = archiveSkill(skill, index.roots);

  // The operator reinstalled the skill while the old copy sat in the archive.
  writeSkill(origin, "delta", "the reinstalled one");

  const archived = cardAt(moved.to);
  assert.throws(
    () => restoreSkill(archived.skill, archived.index.roots),
    (err) => err.status === 409 && /already at/i.test(err.message),
    "restoring onto a live skill must be refused",
  );

  assert.equal(occupied(moved.to), true, "the archived copy must survive");
  assert.equal(
    fs.readFileSync(path.join(origin, "SKILL.md"), "utf8").includes("reinstalled"),
    true,
    "the live skill must be untouched",
  );
});

test("archiving the same slug twice keeps both copies", () => {
  const origin = path.join(drawer(".claude"), "echo");
  writeSkill(origin, "echo", "first cut");
  const first = cardAt(origin);
  const one = archiveSkill(first.skill, first.index.roots);

  writeSkill(origin, "echo", "second cut");
  const second = cardAt(origin);
  const two = archiveSkill(second.skill, second.index.roots);

  assert.notEqual(one.to, two.to, "the second archive must not reuse the path");
  assert.equal(occupied(one.to), true, "the first archive must survive");
  assert.equal(
    fs.readFileSync(path.join(one.to, "SKILL.md"), "utf8").includes("first cut"),
    true,
    "the older archived copy must keep its own contents",
  );
  assert.equal(
    fs.readFileSync(path.join(two.to, "SKILL.md"), "utf8").includes("second cut"),
    true,
  );
});

test("a loose .md skill archives and restores under its own filename", () => {
  const origin = path.join(drawer(".codex"), "foxtrot.md");
  fs.writeFileSync(
    origin,
    "---\nname: foxtrot\ndescription: a single file skill\n---\n\nbody\n",
    "utf8",
  );

  const { index, skill } = cardAt(origin);
  assert.equal(skill.file, true);
  const moved = archiveSkill(skill, index.roots);
  assert.equal(path.basename(moved.to), "foxtrot.md");
  assert.equal(occupied(origin), false);

  const archived = cardAt(moved.to);
  const back = restoreSkill(archived.skill, archived.index.roots);
  assert.equal(path.resolve(back.to), path.resolve(origin));
  assert.equal(occupied(origin), true);
});

test("archiving a symlinked skill moves the link, not the target", { skip: !LINK_KIND }, () => {
  const target = writeSkill(path.join(HOME, "repo", "golf"), "golf");
  const origin = path.join(drawer(".agents"), "golf");
  fs.symlinkSync(target, origin, LINK_KIND);

  const { index, skill } = cardAt(origin);
  assert.equal(skill.link, true, "the card should be seen as a symlink");
  const moved = archiveSkill(skill, index.roots);

  assert.equal(
    fs.lstatSync(moved.to).isSymbolicLink(),
    true,
    "the archived copy must still be a link, not a copied tree",
  );
  assert.equal(
    occupied(path.join(target, "SKILL.md")),
    true,
    "the repository the link pointed at must be untouched",
  );

  const archived = cardAt(moved.to);
  restoreSkill(archived.skill, archived.index.roots);
  assert.equal(fs.lstatSync(origin).isSymbolicLink(), true);
});

test("restore refuses when the drawer it came from is gone", () => {
  const origin = writeSkill(path.join(drawer(".hermes"), "juliet"), "juliet");
  const { index, skill } = cardAt(origin);
  const moved = archiveSkill(skill, index.roots);

  // The whole drawer was removed while the card sat in the archive.
  fs.rmSync(path.join(HOME, ".hermes"), { recursive: true, force: true });

  const archived = cardAt(moved.to);
  assert.throws(
    () => restoreSkill(archived.skill, archived.index.roots),
    (err) => err.status === 403 && /no cabinet drawer/i.test(err.message),
    "restoring into a drawer that no longer exists must be refused",
  );
  assert.equal(
    occupied(path.join(moved.to, "SKILL.md")),
    true,
    "the archived copy must survive a refused restore",
  );
});

test("archive refuses a path outside every cabinet root", () => {
  const stray = writeSkill(path.join(HOME, "not-a-drawer", "hotel"), "hotel");
  const index = scanSkills();

  assert.throws(
    () =>
      archiveSkill(
        {
          path: stray,
          name: "hotel",
          slug: "hotel",
          scopeId: "claude",
          scopeLabel: ".claude",
          kind: "user",
          archived: false,
        },
        index.roots,
      ),
    (err) => err.status === 403,
    "a skill outside the known roots must not be movable",
  );
  assert.equal(occupied(path.join(stray, "SKILL.md")), true);
});

test("archive refuses a drawer root itself", () => {
  const root = drawer(".claude");
  const index = scanSkills();

  assert.throws(
    () =>
      archiveSkill(
        {
          path: root,
          name: "skills",
          slug: "skills",
          scopeId: "claude",
          scopeLabel: ".claude",
          kind: "user",
          archived: false,
        },
        index.roots,
      ),
    (err) => err.status === 403 && /cabinet root/i.test(err.message),
  );
  assert.equal(occupied(root), true);
});

test("an already archived card cannot be archived again", () => {
  const origin = writeSkill(path.join(drawer(".claude"), "india"), "india");
  const { index, skill } = cardAt(origin);
  const moved = archiveSkill(skill, index.roots);

  const archived = cardAt(moved.to);
  assert.throws(
    () => archiveSkill(archived.skill, archived.index.roots),
    (err) => err.status === 400 && /already in the archive/i.test(err.message),
  );
});
