import fs from "node:fs";
import path from "node:path";

const STANDING_ORDER =
  /\b(?:must\s+always\s+apply|always\s+apply|on\s+every\s+(?:request|turn|message|prompt)|before\s+every\s+(?:request|turn|message|prompt)|hooked\s+into\s+every|injected\s+at\s+session\s+start)\b/i;

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function isTruthy(value) {
  return value === true || value === "true" || value === "yes";
}

function hooksAt(dir) {
  const nested = path.join(dir, "hooks", "hooks.json");
  if (exists(nested)) return nested;
  const flat = path.join(dir, "hooks.json");
  if (exists(flat)) return flat;
  return "";
}

export function findSkillHooks(skillDir, { fileOnly = false } = {}) {
  const start = fileOnly ? path.dirname(skillDir) : skillDir;
  return hooksAt(start);
}

export function skillInvocation({
  skillDir,
  fileOnly = false,
  frontmatter = {},
  description = "",
}) {
  const hookPath = findSkillHooks(skillDir, { fileOnly });
  if (hookPath) {
    return {
      invocation: "hook",
      invocationEvidence: `hooks.json at ${hookPath}`,
    };
  }

  const meta =
    frontmatter.metadata && typeof frontmatter.metadata === "object"
      ? frontmatter.metadata
      : {};

  if (
    isTruthy(frontmatter.sessionStart) ||
    isTruthy(meta.sessionStart) ||
    isTruthy(frontmatter.alwaysApply) ||
    isTruthy(meta.alwaysApply)
  ) {
    const key = isTruthy(frontmatter.sessionStart) || isTruthy(meta.sessionStart)
      ? "sessionStart"
      : "alwaysApply";
    return {
      invocation: "hook",
      invocationEvidence: `frontmatter ${key}`,
    };
  }

  const blurb = description || (typeof frontmatter.description === "string" ? frontmatter.description : "");
  if (STANDING_ORDER.test(blurb)) {
    return {
      invocation: "hook",
      invocationEvidence: "description standing order",
    };
  }

  if (isTruthy(frontmatter["disable-model-invocation"])) {
    return {
      invocation: "user",
      invocationEvidence: "frontmatter disable-model-invocation",
    };
  }

  return {
    invocation: "model",
    invocationEvidence: "default: the model may call this",
  };
}
