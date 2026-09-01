import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import express from "express";
import {
  scanSkills,
  readSkill,
  readSkillFile,
  assertDeletable,
  deleteSkillDir,
  ARCHIVE_ROOT,
} from "./scan.js";
import { archiveSkill, restoreSkill, archiveRecordFor } from "./archive.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PREFERRED_PORT = Number(process.env.PORT || 3781);
const isProd = process.env.NODE_ENV === "production";

let cache = { at: 0, payload: null };
const TTL_MS = 2000;

function getIndex(force = false) {
  if (!force && cache.payload && Date.now() - cache.at < TTL_MS) {
    return cache.payload;
  }
  const payload = scanSkills();
  cache = { at: Date.now(), payload };
  return payload;
}

function openBrowser(url) {
  if (process.env.SKILL_CABINET_NO_OPEN === "1") return;
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/skills", (req, res) => {
  try {
    const index = getIndex(req.query.refresh === "1");
    const scopes = [];
    const byScope = new Map();
    for (const skill of index.skills) {
      if (!byScope.has(skill.scopeId)) {
        byScope.set(skill.scopeId, {
          id: skill.scopeId,
          label: skill.scopeLabel,
          kind: skill.kind,
          count: 0,
        });
        scopes.push(byScope.get(skill.scopeId));
      }
      byScope.get(skill.scopeId).count += 1;
    }
    res.json({
      home: process.env.HOME,
      archiveRoot: ARCHIVE_ROOT,
      scannedAt: cache.at,
      // The census counts what the agents can actually see. Archived cards are
      // still indexed, so the tray can show them, but they are not installed.
      total: index.skills.filter((skill) => !skill.archived).length,
      scopes,
      skills: index.skills,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/skills/:id", (req, res) => {
  try {
    const index = getIndex();
    const summary = index.byId.get(req.params.id);
    if (!summary) {
      res.status(404).json({ error: "Skill not in the cabinet" });
      return;
    }
    const detail = readSkill(summary);
    if (summary.archived) {
      const record = archiveRecordFor(summary.path);
      if (record) {
        detail.archivedFrom = record.originPath;
        detail.archivedAt = record.archivedAt;
      }
    }
    res.json(detail);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get("/api/skills/:id/file", (req, res) => {
  try {
    const rel = String(req.query.path || "");
    if (!rel) {
      res.status(400).json({ error: "Missing path" });
      return;
    }
    const index = getIndex();
    const summary = index.byId.get(req.params.id);
    if (!summary) {
      res.status(404).json({ error: "Skill not in the cabinet" });
      return;
    }
    res.json(readSkillFile(summary, rel));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Delete, archive and restore all walk the same list and fail the same way: one
// bad card reports its own error and the rest of the batch still runs.
function applyToIds(ids, apply) {
  const index = getIndex(true);
  const done = [];
  const errors = [];
  for (const id of ids) {
    const summary = index.byId.get(id);
    if (!summary) {
      errors.push({ id, error: "Skill not in the cabinet" });
      continue;
    }
    try {
      done.push({ id, name: summary.name, ...apply(summary, index) });
    } catch (err) {
      errors.push({ id, error: err.message, path: summary.path });
    }
  }
  cache = { at: 0, payload: null };
  return { done, errors };
}

function deleteIds(ids) {
  const { done, errors } = applyToIds(ids, (summary, index) => {
    const target = assertDeletable(summary, index.roots);
    deleteSkillDir(target);
    return { path: target };
  });
  return { deleted: done, errors };
}

function archiveIds(ids) {
  const { done, errors } = applyToIds(ids, (summary, index) =>
    archiveSkill(summary, index.roots),
  );
  return { archived: done, errors };
}

function restoreIds(ids) {
  const { done, errors } = applyToIds(ids, (summary, index) =>
    restoreSkill(summary, index.roots),
  );
  return { restored: done, errors };
}

function idsFrom(body) {
  const ids = Array.isArray(body?.ids) ? body.ids : [];
  if (!ids.length) {
    const err = new Error("No cards selected");
    err.status = 400;
    throw err;
  }
  return ids.map(String);
}

app.delete("/api/skills/:id", (req, res) => {
  try {
    const result = deleteIds([req.params.id]);
    const status = result.deleted.length ? 200 : 400;
    res.status(status).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post("/api/skills/delete", (req, res) => {
  try {
    res.json(deleteIds(idsFrom(req.body)));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post("/api/skills/archive", (req, res) => {
  try {
    res.json(archiveIds(idsFrom(req.body)));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post("/api/skills/restore", (req, res) => {
  try {
    res.json(restoreIds(idsFrom(req.body)));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

if (isProd) {
  const dist = path.join(ROOT, "dist");
  if (!fs.existsSync(path.join(dist, "index.html"))) {
    console.error("skill-cabinet: missing dist/. Run `npm run build` first.");
    process.exit(1);
  }
  app.use(express.static(dist));
  app.use((req, res) => {
    if (req.path.startsWith("/api")) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.sendFile(path.join(dist, "index.html"));
  });
}

function start(port, attemptsLeft = 20) {
  const server = app.listen(port, "127.0.0.1");
  server.on("listening", () => {
    const { port: bound } = server.address();
    const url = `http://127.0.0.1:${bound}`;
    if (isProd) {
      console.log(`Skill Cabinet at ${url}`);
      openBrowser(url);
    } else {
      console.log(`Skill cabinet api on ${url}`);
    }
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && !process.env.PORT && attemptsLeft > 0) {
      start(port + 1, attemptsLeft - 1);
      return;
    }
    console.error(`Could not bind 127.0.0.1:${port}: ${err.message}`);
    process.exit(1);
  });
}

start(PREFERRED_PORT);
