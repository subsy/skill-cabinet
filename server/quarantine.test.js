import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const HOME = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "skill-cabinet-q-")),
);
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;

const { scanSkills, quarantineRoot, assertDeletable, deleteSkillDir } =
  await import("./scan.js");
const {
  quarantineSkill,
  restoreSkill,
  readManifest,
  forgetQuarantinePath,
} = await import("./quarantine.js");

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

test("quarantine moves a skill out of its drawer", () => {
  const origin = writeSkill(path.join(drawer(".claude"), "alpha"), "alpha");
  const { index, skill } = cardAt(origin);
  assert.ok(skill);
  assert.equal(skill.quarantined, false);

  const moved = quarantineSkill(skill, index.roots);

  assert.equal(occupied(origin), false);
  assert.ok(moved.to.startsWith(quarantineRoot()));

  const after = scanSkills();
  const held = after.skills.find(
    (s) => path.resolve(s.path) === path.resolve(moved.to),
  );
  assert.ok(held);
  assert.equal(held.quarantined, true);
  assert.equal(held.scopeId, "quarantine");
  assert.equal(held.fromScope, "claude");
  assert.equal(held.name, "alpha");
  assert.equal(after.census.total, 0);
});

test("a quarantined skill is never indexed as a live drawer", () => {
  const origin = writeSkill(path.join(drawer(".codex"), "bravo"), "bravo");
  const { index, skill } = cardAt(origin);
  quarantineSkill(skill, index.roots);

  const after = scanSkills();
  const live = after.skills.filter((s) => !s.quarantined);
  assert.equal(
    live.some((s) => s.name === "bravo"),
    false,
  );
  assert.equal(
    after.roots.some(
      (r) => r.kind !== "quarantine" && r.root.includes(".skill-cabinet"),
    ),
    false,
  );
});

test("restore puts the skill back at its exact original path", () => {
  const origin = writeSkill(path.join(drawer(".agents"), "charlie"), "charlie");
  const first = cardAt(origin);
  const moved = quarantineSkill(first.skill, first.index.roots);

  const second = cardAt(moved.to);
  const back = restoreSkill(second.skill, second.index.roots);

  assert.equal(path.resolve(back.to), path.resolve(origin));
  assert.equal(occupied(origin), true);
  assert.equal(occupied(moved.to), false);
  assert.equal(
    readManifest().entries.some((e) => e.quarantinePath === moved.to),
    false,
  );

  const after = scanSkills();
  const live = after.skills.find(
    (s) => path.resolve(s.path) === path.resolve(origin),
  );
  assert.ok(live);
  assert.equal(live.quarantined, false);
  assert.equal(live.scopeId, "agents");
});

test("restore refuses an occupied path and keeps the quarantined copy", () => {
  const origin = writeSkill(path.join(drawer(".claude"), "delta"), "delta");
  const { index, skill } = cardAt(origin);
  const moved = quarantineSkill(skill, index.roots);
  writeSkill(origin, "delta", "the reinstalled one");

  const held = cardAt(moved.to);
  assert.throws(
    () => restoreSkill(held.skill, held.index.roots),
    (err) => err.status === 409 && /already at/i.test(err.message),
  );
  assert.equal(occupied(moved.to), true);
  assert.equal(
    fs.readFileSync(path.join(origin, "SKILL.md"), "utf8").includes("reinstalled"),
    true,
  );
});

test("quarantining the same slug twice keeps both copies", () => {
  const origin = path.join(drawer(".claude"), "echo");
  writeSkill(origin, "echo", "first cut");
  const first = cardAt(origin);
  const one = quarantineSkill(first.skill, first.index.roots);

  writeSkill(origin, "echo", "second cut");
  const second = cardAt(origin);
  const two = quarantineSkill(second.skill, second.index.roots);

  assert.notEqual(one.to, two.to);
  assert.equal(occupied(one.to), true);
  assert.equal(
    fs.readFileSync(path.join(one.to, "SKILL.md"), "utf8").includes("first cut"),
    true,
  );
});

test("a loose .md skill quarantines and restores under its own filename", () => {
  const origin = path.join(drawer(".codex"), "foxtrot.md");
  fs.writeFileSync(
    origin,
    "---\nname: foxtrot\ndescription: a single file skill\n---\n\nbody\n",
    "utf8",
  );

  const { index, skill } = cardAt(origin);
  assert.equal(skill.file, true);
  const moved = quarantineSkill(skill, index.roots);
  assert.equal(path.basename(moved.to), "foxtrot.md");

  const held = cardAt(moved.to);
  restoreSkill(held.skill, held.index.roots);
  assert.equal(occupied(origin), true);
});

test(
  "quarantining a symlink moves the link, not the target",
  { skip: !LINK_KIND },
  () => {
    const target = writeSkill(path.join(HOME, "repo", "golf"), "golf");
    const origin = path.join(drawer(".agents"), "golf");
    fs.symlinkSync(target, origin, LINK_KIND);

    const { index, skill } = cardAt(origin);
    assert.equal(skill.link, true);
    const moved = quarantineSkill(skill, index.roots);

    assert.equal(fs.lstatSync(moved.to).isSymbolicLink(), true);
    assert.equal(occupied(path.join(target, "SKILL.md")), true);

    const held = cardAt(moved.to);
    restoreSkill(held.skill, held.index.roots);
    assert.equal(fs.lstatSync(origin).isSymbolicLink(), true);
  },
);

test("restore refuses when the drawer it came from is gone", () => {
  const origin = writeSkill(path.join(drawer(".cursor"), "juliet"), "juliet");
  const { index, skill } = cardAt(origin);
  const moved = quarantineSkill(skill, index.roots);
  fs.rmSync(path.join(HOME, ".cursor"), { recursive: true, force: true });

  const held = cardAt(moved.to);
  assert.throws(
    () => restoreSkill(held.skill, held.index.roots),
    (err) => err.status === 403 && /no cabinet drawer/i.test(err.message),
  );
  assert.equal(occupied(path.join(moved.to, "SKILL.md")), true);
});

test("quarantine refuses a path outside every cabinet root", () => {
  const stray = writeSkill(path.join(HOME, "not-a-drawer", "hotel"), "hotel");
  const index = scanSkills();
  assert.throws(
    () =>
      quarantineSkill(
        {
          path: stray,
          name: "hotel",
          slug: "hotel",
          scopeId: "claude",
          scopeLabel: ".claude",
          kind: "user",
          quarantined: false,
        },
        index.roots,
      ),
    (err) => err.status === 403,
  );
  assert.equal(occupied(path.join(stray, "SKILL.md")), true);
});

test("an already quarantined card cannot be quarantined again", () => {
  const origin = writeSkill(path.join(drawer(".claude"), "india"), "india");
  const { index, skill } = cardAt(origin);
  const moved = quarantineSkill(skill, index.roots);
  const held = cardAt(moved.to);
  assert.throws(
    () => quarantineSkill(held.skill, held.index.roots),
    (err) => err.status === 400 && /already in the quarantine/i.test(err.message),
  );
});

test("Hermes profile skills are labelled and scanned recursively", () => {
  const nested = path.join(
    HOME,
    ".hermes",
    "profiles",
    "coding",
    "skills",
    "nested",
    "deep-research",
  );
  writeSkill(nested, "deep-research");
  const index = scanSkills();
  const skill = index.skills.find((s) => s.slug === "deep-research");
  assert.ok(skill, "nested Hermes skill is indexed");
  assert.equal(skill.scopeId, "hermes-profile:coding");
  assert.equal(skill.scopeLabel, "Hermes profile · coding");
  assert.equal(skill.quarantined, false);
});

test("deleting a quarantined skill drops its quarantine record", () => {
  const origin = writeSkill(path.join(drawer(".claude"), "kilo"), "kilo");
  const { index, skill } = cardAt(origin);
  const moved = quarantineSkill(skill, index.roots);
  const held = cardAt(moved.to);
  const target = assertDeletable(held.skill, held.index.roots);
  deleteSkillDir(target);
  forgetQuarantinePath(target);
  assert.equal(occupied(moved.to), false);
  assert.equal(
    readManifest().entries.some((e) => e.quarantinePath === moved.to),
    false,
  );
});
