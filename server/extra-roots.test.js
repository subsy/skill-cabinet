import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverRoots, scanRoots } from "./scan.js";

describe("SKILL_CABINET_EXTRA_ROOTS", () => {
  it("adopts label=path entries as user drawers", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "cabinet-extra-"));
    const dir = path.join(base, "myskills", "demo");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      "---\nname: demo\ndescription: Demo skill for testing.\n---\n\nBody.\n",
    );
    process.env.SKILL_CABINET_EXTRA_ROOTS = `demo=${path.join(base, "myskills")}`;
    try {
      const roots = discoverRoots();
      const hit = roots.find((r) => r.scopeId === "extra-demo");
      assert.ok(hit, "extra root adopted");
      assert.equal(hit.kind, "user");
      const { skills } = scanRoots(roots);
      assert.ok(
        skills.some((s) => s.slug === "demo" && s.scopeId === "extra-demo"),
        "skill inside extra root is indexed",
      );
    } finally {
      delete process.env.SKILL_CABINET_EXTRA_ROOTS;
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("ignores malformed entries and missing dirs", () => {
    process.env.SKILL_CABINET_EXTRA_ROOTS =
      "nonsense,,=,=x,ghost=/no/such/dir/anywhere";
    try {
      const roots = discoverRoots();
      assert.ok(
        !roots.some((r) => r.scopeId.startsWith("extra-")),
        "no extra roots adopted",
      );
    } finally {
      delete process.env.SKILL_CABINET_EXTRA_ROOTS;
    }
  });
});
