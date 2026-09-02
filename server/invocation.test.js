import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { skillInvocation } from "./invocation.js";
import { scanRoots } from "./scan.js";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "skill-cabinet-invoke-"));
}

test("no invocation keys means the model may call it", () => {
  const dir = tempDir();
  try {
    const result = skillInvocation({
      skillDir: dir,
      frontmatter: { name: "adapt" },
      description: "Adapt a design. Use when the user asks.",
    });
    assert.equal(result.invocation, "model");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("disable-model-invocation is user only", () => {
  const dir = tempDir();
  try {
    const result = skillInvocation({
      skillDir: dir,
      frontmatter: { "disable-model-invocation": true },
      description: "Blast radius",
    });
    assert.equal(result.invocation, "user");
    assert.match(result.invocationEvidence, /disable-model-invocation/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("user-invokable alone is still model", () => {
  const dir = tempDir();
  try {
    const result = skillInvocation({
      skillDir: dir,
      frontmatter: { "user-invokable": true },
      description: "SEO audit when the user says audit",
    });
    assert.equal(result.invocation, "model");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("nested metadata.sessionStart is a hook", () => {
  const dir = tempDir();
  try {
    const result = skillInvocation({
      skillDir: dir,
      frontmatter: { metadata: { sessionStart: true } },
      description: "Corrects outdated knowledge",
    });
    assert.equal(result.invocation, "hook");
    assert.match(result.invocationEvidence, /sessionStart/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("sessionStart frontmatter is a hook", () => {
  const dir = tempDir();
  try {
    const result = skillInvocation({
      skillDir: dir,
      frontmatter: { sessionStart: true },
      description: "Warm the session",
    });
    assert.equal(result.invocation, "hook");
    assert.match(result.invocationEvidence, /sessionStart/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("standing-order description is a hook", () => {
  const dir = tempDir();
  try {
    const result = skillInvocation({
      skillDir: dir,
      frontmatter: {},
      description: "Cut AI tells from any writing. Must always apply.",
    });
    assert.equal(result.invocation, "hook");
    assert.match(result.invocationEvidence, /standing order/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("hooks.json in the skill folder is a hook", () => {
  const dir = tempDir();
  try {
    fs.mkdirSync(path.join(dir, "hooks"));
    fs.writeFileSync(path.join(dir, "hooks", "hooks.json"), "{}\n");
    const result = skillInvocation({
      skillDir: dir,
      frontmatter: { "disable-model-invocation": true },
      description: "Also user-only in YAML",
    });
    assert.equal(result.invocation, "hook");
    assert.match(result.invocationEvidence, /hooks\.json/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("do not always apply is not a hook", () => {
  const dir = tempDir();
  try {
    const result = skillInvocation({
      skillDir: dir,
      frontmatter: {},
      description: "Do not always apply this. Use it when the user asks.",
    });
    assert.equal(result.invocation, "model");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("never on every request is not a hook", () => {
  const dir = tempDir();
  try {
    const result = skillInvocation({
      skillDir: dir,
      frontmatter: {},
      description: "Never on every request. Call it when needed.",
    });
    assert.equal(result.invocation, "model");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("do not run on every request is not a hook", () => {
  const dir = tempDir();
  try {
    const result = skillInvocation({
      skillDir: dir,
      frontmatter: {},
      description: "Do not run on every request.",
    });
    assert.equal(result.invocation, "model");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("never run on every request is not a hook", () => {
  const dir = tempDir();
  try {
    const result = skillInvocation({
      skillDir: dir,
      frontmatter: {},
      description: "Never run on every request.",
    });
    assert.equal(result.invocation, "model");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("does not need to always apply is not a hook", () => {
  const dir = tempDir();
  try {
    const result = skillInvocation({
      skillDir: dir,
      frontmatter: {},
      description: "This does not need to always apply.",
    });
    assert.equal(result.invocation, "model");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a negated sentence does not hide a later standing order", () => {
  const dir = tempDir();
  try {
    const result = skillInvocation({
      skillDir: dir,
      frontmatter: {},
      description: "Do not run on every request. Must always apply.",
    });
    assert.equal(result.invocation, "hook");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a but-clause standing order is still a hook", () => {
  const dir = tempDir();
  try {
    const result = skillInvocation({
      skillDir: dir,
      frontmatter: {},
      description: "Do not run on every request, but must always apply.",
    });
    assert.equal(result.invocation, "hook");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("disable-model-invocation and user-invokable false is off", () => {
  const dir = tempDir();
  try {
    const result = skillInvocation({
      skillDir: dir,
      frontmatter: {
        "disable-model-invocation": true,
        "user-invokable": false,
      },
      description: "Held",
    });
    assert.equal(result.invocation, "off");
    assert.match(result.invocationEvidence, /user-invokable/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("hooks.json beside a loose markdown skill is not this skill's hook", () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, "note.md");
    fs.writeFileSync(file, "---\nname: note\n---\n\nBody.\n");
    fs.writeFileSync(path.join(dir, "hooks.json"), "{}\n");
    const result = skillInvocation({
      skillDir: file,
      fileOnly: true,
      frontmatter: {},
      description: "A loose note",
    });
    assert.equal(result.invocation, "model");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a shared drawer hooks.json does not hook neighboring loose skills", () => {
  const dir = tempDir();
  try {
    const skillsDir = path.join(dir, "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillsDir, "alpha.md"),
      "---\nname: alpha\ndescription: First loose skill\n---\n\nA.\n",
    );
    fs.writeFileSync(
      path.join(skillsDir, "beta.md"),
      "---\nname: beta\ndescription: Second loose skill\n---\n\nB.\n",
    );
    fs.writeFileSync(path.join(skillsDir, "hooks.json"), "{}\n");
    const result = scanRoots([
      {
        scopeId: "skills",
        scopeLabel: "skills",
        root: skillsDir,
        kind: "user",
        recursive: false,
      },
    ]);
    const alpha = result.skills.find((s) => s.slug === "alpha");
    const beta = result.skills.find((s) => s.slug === "beta");
    assert.ok(alpha && beta, "both loose skills exist");
    assert.equal(alpha.invocation, "model");
    assert.equal(beta.invocation, "model");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("hooks.json in a parent plugin is not this skill's hook", () => {
  const plugin = tempDir();
  try {
    fs.mkdirSync(path.join(plugin, "hooks"));
    fs.writeFileSync(path.join(plugin, "hooks", "hooks.json"), "{}\n");
    const skillDir = path.join(plugin, "skills", "knowledge-update");
    fs.mkdirSync(skillDir, { recursive: true });
    const result = skillInvocation({
      skillDir,
      frontmatter: {},
      description: "Update knowledge when asked",
    });
    assert.equal(result.invocation, "model");
  } finally {
    fs.rmSync(plugin, { recursive: true, force: true });
  }
});
