import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { skillInvocation } from "./invocation.js";

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
