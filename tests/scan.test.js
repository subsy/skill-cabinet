import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  quarantineSkillDir,
  readSkillFile,
  scanSkills,
} from "../server/scan.js";

async function makeHome() {
  const home = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "skill-cabinet-test-"),
  );
  await fs.promises.mkdir(path.join(home, ".hermes", "skills", "shared"), {
    recursive: true,
  });
  await fs.promises.mkdir(
    path.join(
      home,
      ".hermes",
      "profiles",
      "coding",
      "skills",
      "software-development",
      "nested-skill",
    ),
    { recursive: true },
  );
  await fs.promises.mkdir(
    path.join(home, ".hermes", "profiles", "research", "skills", "direct"),
    { recursive: true },
  );
  await fs.promises.writeFile(
    path.join(home, ".hermes", "skills", "shared", "SKILL.md"),
    "---\nname: shared\n---\n\n# Shared\n",
  );
  await fs.promises.writeFile(
    path.join(
      home,
      ".hermes",
      "profiles",
      "coding",
      "skills",
      "software-development",
      "nested-skill",
      "SKILL.md",
    ),
    "---\nname: nested-skill\n---\n\n# Nested\n",
  );
  await fs.promises.writeFile(
    path.join(home, ".hermes", "profiles", "research", "skills", "direct", "SKILL.md"),
    "---\nname: direct\n---\n\n# Direct\n",
  );
  return home;
}

test("keeps quarantine warning bindings in sync", () => {
  const source = fs.readFileSync(
    path.join(import.meta.dirname, "..", "src", "App.jsx"),
    "utf8",
  );

  assert.equal(source.includes("{builtin.length"), false);
  assert.equal((source.match(/regenerated\.length/g) || []).length, 2);
});

test("discovers nested Hermes profile skills with profile labels", async () => {
  const home = await makeHome();
  const { skills } = scanSkills(home);

  assert.deepEqual(
    skills.map(({ name, kind, scopeId, scopeLabel, profileName }) => ({
      name,
      kind,
      scopeId,
      scopeLabel,
      profileName,
    })),
    [
      {
        name: "shared",
        kind: "user",
        scopeId: "hermes",
        scopeLabel: ".hermes",
        profileName: undefined,
      },
      {
        name: "nested-skill",
        kind: "profile",
        scopeId: "hermes-profile:coding",
        scopeLabel: "Hermes profile · coding",
        profileName: "coding",
      },
      {
        name: "direct",
        kind: "profile",
        scopeId: "hermes-profile:research",
        scopeLabel: "Hermes profile · research",
        profileName: "research",
      },
    ],
  );
});

test("moves a skill into quarantine and records its original location", async () => {
  const home = await makeHome();
  const { skills } = scanSkills(home);
  const skill = skills.find((item) => item.name === "nested-skill");
  assert.ok(skill);

  const result = quarantineSkillDir(skill, home);
  const quarantinedSkill = path.join(result.path, "skill");
  const manifest = JSON.parse(
    await fs.promises.readFile(path.join(result.path, "manifest.json"), "utf8"),
  );

  assert.equal(fs.existsSync(skill.path), false);
  assert.equal(fs.existsSync(path.join(quarantinedSkill, "SKILL.md")), true);
  assert.equal(manifest.originalPath, skill.path);
  assert.equal(manifest.name, "nested-skill");
  assert.equal(manifest.scopeLabel, "Hermes profile · coding");
});

test("does not index symlinked profile skill roots", async () => {
  const home = await makeHome();
  const external = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "skill-cabinet-profile-external-"),
  );
  await fs.promises.writeFile(
    path.join(external, "SKILL.md"),
    "---\nname: outside-profile\n---\n\n# Outside\n",
  );
  const profile = path.join(home, ".hermes", "profiles", "linked-root");
  await fs.promises.mkdir(profile, { recursive: true });
  await fs.promises.symlink(external, path.join(profile, "skills"), "dir");

  const { skills } = scanSkills(home);
  assert.equal(skills.some((skill) => skill.name === "outside-profile"), false);
  assert.equal(
    skills.some((skill) => skill.scopeLabel === "Hermes profile · linked-root"),
    false,
  );
});

test("does not index symlinked skill directories or preview symlinked files", async () => {
  const home = await makeHome();
  const external = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "skill-cabinet-external-"),
  );
  await fs.promises.writeFile(
    path.join(external, "SKILL.md"),
    "---\nname: outside\n---\n\n# Outside\n",
  );
  await fs.promises.symlink(
    external,
    path.join(home, ".hermes", "skills", "linked"),
    "dir",
  );

  const { skills } = scanSkills(home);
  assert.equal(skills.some((skill) => skill.name === "outside"), false);

  const shared = skills.find((skill) => skill.name === "shared");
  assert.ok(shared);
  await fs.promises.writeFile(path.join(external, "secret.txt"), "secret\n");
  await fs.promises.symlink(
    path.join(external, "secret.txt"),
    path.join(shared.path, "secret.txt"),
  );
  assert.throws(
    () => readSkillFile(shared, "secret.txt"),
    /Symbolic links are not previewable/,
  );
});
