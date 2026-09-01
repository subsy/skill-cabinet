import { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import YAML from "yaml";
import {
  fetchCatalog,
  fetchSkill,
  fetchSkillFile,
  quarantineSkills,
} from "./api.js";
import Logo from "./Logo.jsx";
import {
  THEMES,
  applyTheme,
  readStoredTheme,
  writeStoredTheme,
} from "./themes.js";

function formatBytes(n) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 && i ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function formatWhen(ms) {
  if (!ms) return "—";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(new Date(ms));
}

function callNumber(skill) {
  const scope = skill.scopeLabel.replace(/^\./, "").replace(/\//g, "·");
  return `${scope}  ${skill.slug}`;
}

function matchesQuery(skill, q) {
  if (!q) return true;
  const hay = [
    skill.name,
    skill.slug,
    skill.description,
    skill.path,
    skill.scopeLabel,
    JSON.stringify(skill.frontmatter || {}),
  ]
    .join("\n")
    .toLowerCase();
  return hay.includes(q);
}

function stringifyValue(value) {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return YAML.stringify(value).trim();
}

function kindStamp(kind) {
  if (kind === "builtin") return "builtin";
  if (kind === "plugin") return "plugin cache";
  if (kind === "profile") return "Hermes profile";
  return "user";
}

function ThemeSelect() {
  const [theme, setTheme] = useState(() => applyTheme(readStoredTheme()));

  function onChange(event) {
    const next = applyTheme(event.target.value);
    writeStoredTheme(next);
    setTheme(next);
  }

  return (
    <label className="theme-select">
      <span>Theme</span>
      <select value={theme} onChange={onChange} aria-label="Color theme">
        {THEMES.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [scopeId, setScopeId] = useState("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [checked, setChecked] = useState(() => new Set());
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState("");
  const [preview, setPreview] = useState(null);
  const [view, setView] = useState("manuscript");
  const [slip, setSlip] = useState(null);
  const [busy, setBusy] = useState(false);
  const searchRef = useRef(null);
  const listRef = useRef(null);

  async function load(refresh = false) {
    setLoading(true);
    setError("");
    try {
      const data = await fetchCatalog(refresh);
      setCatalog(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const skills = catalog?.skills ?? [];
  const scopes = catalog?.scopes ?? [];

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills.filter((s) => {
      if (scopeId !== "all" && s.scopeId !== scopeId) return false;
      return matchesQuery(s, q);
    });
  }, [skills, scopeId, query]);

  useEffect(() => {
    if (!visible.length) {
      setSelectedId(null);
      return;
    }
    if (!visible.some((s) => s.id === selectedId)) {
      setSelectedId(visible[0].id);
    }
  }, [visible, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setPreview(null);
      return;
    }
    let cancelled = false;
    setDetailError("");
    setPreview(null);
    fetchSkill(selectedId)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setDetail(null);
          setDetailError(err.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    function onKey(e) {
      const tag = e.target.tagName;
      const typing =
        tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (typing) {
        if (e.key === "Escape") e.target.blur();
        return;
      }
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const i = visible.findIndex((s) => s.id === selectedId);
        const next = e.key === "j" ? i + 1 : i - 1;
        const skill = visible[Math.max(0, Math.min(visible.length - 1, next))];
        if (skill) {
          setSlip(null);
          setSelectedId(skill.id);
          const el = listRef.current?.querySelector(`[data-id="${skill.id}"]`);
          el?.scrollIntoView({ block: "nearest" });
        }
      }
      if (e.key === "x" && selectedId) {
        e.preventDefault();
        toggleChecked(selectedId);
      }
      if (e.key === "d" && !slip) {
        e.preventDefault();
        openSlip(checked.size ? [...checked] : selectedId ? [selectedId] : []);
      }
      if (e.key === "Escape" && slip) {
        setSlip(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selectedId, checked, slip]);

  function toggleChecked(id) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleVisible() {
    const ids = visible.map((s) => s.id);
    const allOn = ids.every((id) => checked.has(id));
    setChecked((prev) => {
      const next = new Set(prev);
      if (allOn) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }

  function openSlip(ids) {
    if (!ids.length) return;
    const cards = ids
      .map((id) => skills.find((s) => s.id === id))
      .filter(Boolean);
    setSlip({
      ids,
      cards,
    });
  }

  async function confirmQuarantine() {
    if (!slip) return;
    setBusy(true);
    setNotice("");
    try {
      const result = await quarantineSkills(slip.ids);
      const n = result.quarantined.length;
      setNotice(
        n
          ? `Quarantined ${n} card${n === 1 ? "" : "s"}. Original paths are recorded.`
          : "Nothing was quarantined.",
      );
      if (result.errors?.length) {
        setError(result.errors.map((e) => e.error).join("; "));
      }
      setSlip(null);
      setChecked(new Set());
      setDetail(null);
      setSelectedId(null);
      await load(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function openFile(relPath) {
    if (!selectedId) return;
    if (relPath === "SKILL.md") {
      setPreview(null);
      return;
    }
    try {
      const file = await fetchSkillFile(selectedId, relPath);
      setPreview(file);
      setView("source");
    } catch (err) {
      setDetailError(err.message);
    }
  }

  const selected = skills.find((s) => s.id === selectedId) || detail;
  return (
    <div className="desk">
      <header className="masthead">
        <div className="wordmark">
          <Logo className="mark" />
          <div className="wordmark-text">
            <p className="edition">Local filesystem · user cabinet</p>
            <h1>Skill Cabinet</h1>
          </div>
        </div>
        <div className="finder">
          <label>
            <span>Find</span>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="name, description, path, frontmatter"
              type="search"
              spellCheck="false"
            />
          </label>
          <p className="keys">j k move · / find · x mark · d quarantine</p>
        </div>
        <div className="mast-tools">
          <p className="census">
            <b>{loading ? "…" : catalog?.total ?? 0}</b>
            <span>in house</span>
            <button type="button" className="textish" onClick={() => load(true)}>
              Reshelve
            </button>
          </p>
          <ThemeSelect />
        </div>
      </header>

      {(error || notice) && (
        <div className="notices">
          {notice && <p className="notice">{notice}</p>}
          {error && <p className="notice fault">{error}</p>}
        </div>
      )}

      <div className="furniture">
        <nav className="drawers" aria-label="Scopes">
          <button
            type="button"
            className={scopeId === "all" ? "drawer on" : "drawer"}
            onClick={() => {
              setSlip(null);
              setScopeId("all");
            }}
          >
            <i />
            <span>All drawers</span>
            <em>{catalog?.total ?? 0}</em>
          </button>
          {scopes.map((scope) => (
            <button
              key={scope.id}
              type="button"
              className={scopeId === scope.id ? "drawer on" : "drawer"}
              onClick={() => {
                setSlip(null);
                setScopeId(scope.id);
              }}
            >
              <i data-kind={scope.kind} />
              <span>{scope.label}</span>
              <em>{scope.count}</em>
            </button>
          ))}
        </nav>

        <section className="tray" aria-label="Skills">
          <div className="tray-head">
            <label className="check">
              <input
                type="checkbox"
                checked={
                  visible.length > 0 && visible.every((s) => checked.has(s.id))
                }
                onChange={toggleVisible}
              />
              <span>
                {visible.length} shown
                {checked.size ? ` · ${checked.size} marked` : ""}
              </span>
            </label>
            <button
              type="button"
              className="stamp"
              disabled={!checked.size && !selectedId}
              onClick={() =>
                openSlip(checked.size ? [...checked] : selectedId ? [selectedId] : [])
              }
            >
              Quarantine
            </button>
          </div>
          <ol ref={listRef} className="cards">
            {visible.map((skill) => (
              <li key={skill.id}>
                <article
                  data-id={skill.id}
                  className={
                    skill.id === selectedId ? "index-card selected" : "index-card"
                  }
                  onClick={() => {
                    setSlip(null);
                    setSelectedId(skill.id);
                  }}
                >
                  <label
                    className="tick"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={checked.has(skill.id)}
                      onChange={() => toggleChecked(skill.id)}
                    />
                  </label>
                  <p className="call">{callNumber(skill)}</p>
                  <h2>{skill.name}</h2>
                  <p className="blurb">
                    {skill.description || "No description in the frontmatter."}
                  </p>
                  <p className="meta">
                    <span data-kind={skill.kind}>{kindStamp(skill.kind)}</span>
                    <time>{formatWhen(skill.mtime)}</time>
                  </p>
                </article>
              </li>
            ))}
            {!loading && !visible.length && (
              <li className="empty-tray">
                No cards in this drawer
                {query ? " match the search." : "."}
              </li>
            )}
          </ol>
        </section>

        <main className="reader" aria-live="polite">
          {slip ? (
            <QuarantineConfirm
              slip={slip}
              busy={busy}
              onCancel={() => setSlip(null)}
              onConfirm={confirmQuarantine}
            />
          ) : !selected ? (
            <EmptyReader loading={loading} />
          ) : (
            <SkillLeaf
              selected={selected}
              detail={detail}
              detailError={detailError}
              preview={preview}
              view={view}
              setView={setView}
              onOpenFile={openFile}
              onQuarantine={() => openSlip([selected.id])}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function EmptyReader({ loading }) {
  return (
    <div className="leaf empty">
      <p className="edition">Reading desk</p>
      <h2>{loading ? "Opening the cabinet…" : "Select a card"}</h2>
      <p>
        {loading
          ? "Walking known skill drawers on this machine."
          : "Choose a skill from the tray. The manuscript, frontmatter, and any accompanying files will be laid out here."}
      </p>
    </div>
  );
}

function QuarantineConfirm({ slip, busy, onCancel, onConfirm }) {
  const regenerated = slip.cards.filter(
    (c) => c.kind === "builtin" || c.kind === "plugin",
  );
  return (
    <div className="leaf slip">
      <p className="edition">Quarantine</p>
      <h2>
        Quarantine {slip.cards.length} card
        {slip.cards.length === 1 ? "" : "s"}
      </h2>
      <p className="warning">
        This moves the skill folder to ~/.skill-cabinet-quarantine. Its original
        path is recorded in manifest.json so it can be restored manually.
      </p>
      {regenerated.length > 0 && (
        <p className="warning">
          {regenerated.length} of these live in a plugin cache or builtin drawer and
          may return the next time that tool updates.
        </p>
      )}
      <ol className="slip-list">
        {slip.cards.map((card) => (
          <li key={card.id}>
            <strong>{card.name}</strong>
            <code>{card.path}</code>
          </li>
        ))}
      </ol>
      <div className="slip-actions">
        <button type="button" className="textish" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="stamp"
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? "Quarantining…" : "Quarantine"}
        </button>
      </div>
    </div>
  );
}

function SkillLeaf({
  selected,
  detail,
  detailError,
  preview,
  view,
  setView,
  onOpenFile,
  onQuarantine,
}) {
  const fm = detail?.frontmatter || selected.frontmatter || {};
  const keys = Object.keys(fm);
  const files = detail?.files || [];
  const body = preview
    ? preview.binary
      ? `Binary file · ${formatBytes(preview.size)}`
      : preview.content
    : view === "source"
      ? detail?.source || ""
      : detail?.body || "";

  return (
    <article className="leaf">
      <header className="leaf-head">
        <div className="leaf-ident">
          <p className="call">{callNumber(selected)}</p>
          <h2>{selected.name}</h2>
          <p className="path">{selected.path}</p>
          <p className="stamps">
            <span data-kind={selected.kind}>{kindStamp(selected.kind)}</span>
            {detail ? <span>{formatBytes(detail.bytes)}</span> : null}
            <span>{formatWhen(selected.mtime)}</span>
          </p>
        </div>
        <button type="button" className="stamp" onClick={onQuarantine}>
          Quarantine this skill
        </button>
        <div className="leaf-tools">
          <div className="toggle">
            <button
              type="button"
              className={!preview && view === "manuscript" ? "on" : ""}
              onClick={() => {
                setView("manuscript");
                onOpenFile("SKILL.md");
              }}
            >
              Manuscript
            </button>
            <button
              type="button"
              className={!preview && view === "source" ? "on" : ""}
              onClick={() => {
                onOpenFile("SKILL.md");
                setView("source");
              }}
            >
              Source
            </button>
          </div>
        </div>
      </header>

      {keys.length > 0 && (
        <section className="catalogue">
          <h3>Frontmatter</h3>
          <dl>
            {keys.map((key) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{stringifyValue(fm[key])}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {files.length > 0 && (
        <section className="folio">
          <h3>Folio</h3>
          <ul>
            {files.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  className={
                    (preview && preview.path === file.path) ||
                    (!preview && file.path === "SKILL.md")
                      ? "on"
                      : ""
                  }
                  onClick={() => onOpenFile(file.path)}
                >
                  {file.path}
                </button>
                <span>{formatBytes(file.size)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {detailError && <p className="notice fault">{detailError}</p>}

      <section className="manuscript">
        {preview && (
          <p className="edition">
            {preview.path}
            {preview.binary ? " · not a text preview" : ""}
          </p>
        )}
        {!detail && !detailError ? (
          <p className="edition">Fetching the manuscript…</p>
        ) : preview || view === "source" ? (
          <pre className="source">
            <code>{body}</code>
          </pre>
        ) : (
          <div className="prose">
            <Markdown remarkPlugins={[remarkGfm]}>
              {detail?.body || "*This skill has no body after the frontmatter.*"}
            </Markdown>
          </div>
        )}
      </section>
    </article>
  );
}
