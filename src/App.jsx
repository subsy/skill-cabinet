import { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import YAML from "yaml";
import {
  fetchCatalog,
  fetchSkill,
  fetchSkillFile,
  deleteSkills,
} from "./api.js";
import Logo from "./Logo.jsx";
import {
  LINK_FILTERS,
  RISK_FILTERS,
  WHEN_FILTERS,
  THEMES,
  applyTheme,
  matchesLinkFilter,
  matchesRiskFilter,
  matchesWhenFilter,
  readStoredLinkFilter,
  readStoredRiskFilter,
  readStoredWhenFilter,
  readStoredTheme,
  writeStoredLinkFilter,
  writeStoredRiskFilter,
  writeStoredWhenFilter,
  writeStoredTheme,
} from "./themes.js";
import { deleteEffect } from "../server/delete-effect.js";

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
    skill.file ? "file" : "",
    skill.link ? "symlink link" : "",
    skill.linkTarget || "",
    skill.origin?.label || "",
    skill.origin?.url || "",
    skill.risk && skill.risk !== "none" ? `risk ${skill.risk}` : "",
    skill.copyCount ? `copy copies ${skill.copyCount}` : "",
    skill.invocation === "hook"
      ? "hook every request"
      : skill.invocation === "user"
        ? "user only"
        : "model may call",
    skill.invocationEvidence || "",
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
  return "user";
}

function originTitle(origin) {
  if (origin.certainty === "inferred") {
    return "Taken from a parent plugin or git remote. This may name the wrapper rather than this skill's own repository.";
  }
  return "Taken from the skill's frontmatter or install path.";
}

function OriginLink({ origin }) {
  if (!origin?.url) return null;
  const inferred = origin.certainty === "inferred";
  return (
    <>
      <a
        href={origin.url}
        target="_blank"
        rel="noopener noreferrer"
        data-origin={origin.kind}
        title={originTitle(origin)}
        onClick={(event) => event.stopPropagation()}
      >
        {origin.label}
      </a>
      {inferred ? (
        <span data-origin-certainty="inferred" title={originTitle(origin)}>
          inferred
        </span>
      ) : null}
    </>
  );
}

function riskStamp(risk) {
  if (risk === "critical" || risk === "high") return "high risk";
  if (risk === "medium" || risk === "low") return "risk";
  return "";
}

function invokeStamp(mode) {
  if (mode === "hook") return "hook";
  if (mode === "user") return "user only";
  return "";
}

function copyStamp(copies, copyCount) {
  const n = copyCount ?? copies?.length ?? 0;
  if (!n) return "";
  return n === 1 ? "1 copy" : `${n} copies`;
}

function formStamps(skill, { origin = "attested" } = {}) {
  const marks = [];
  if (skill.link) {
    marks.push(
      <span key="link" data-form="link">
        symlink
      </span>,
    );
  }
  if (skill.file) {
    marks.push(
      <span key="file" data-form="file">
        file
      </span>,
    );
  }
  const copies = copyStamp(skill.copies, skill.copyCount);
  if (copies) {
    marks.push(
      <span key="copies" data-copies="">
        {copies}
      </span>,
    );
  }
  const risk = riskStamp(skill.risk);
  if (risk) {
    marks.push(
      <span key="risk" data-risk={skill.risk}>
        {risk}
      </span>,
    );
  }
  const when = invokeStamp(skill.invocation);
  if (when) {
    marks.push(
      <span key="when" data-invoke={skill.invocation} title={skill.invocationEvidence || ""}>
        {when}
      </span>,
    );
  }
  if (
    skill.origin &&
    (origin === "all" || skill.origin.certainty === "attested")
  ) {
    marks.push(<OriginLink key="origin" origin={skill.origin} />);
  }
  return marks;
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

function LinkFilterSelect({ value, onChange }) {
  return (
    <label className="tray-filter">
      <span>Symlinks</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Symlink filter"
      >
        {LINK_FILTERS.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function RiskFilterSelect({ value, onChange }) {
  return (
    <label className="tray-filter">
      <span>Risk</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Risk filter"
      >
        {RISK_FILTERS.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function WhenFilterSelect({ value, onChange }) {
  return (
    <label className="tray-filter">
      <span>When</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="When the skill runs"
      >
        {WHEN_FILTERS.map((item) => (
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
  const [linkFilter, setLinkFilter] = useState(readStoredLinkFilter);
  const [riskFilter, setRiskFilter] = useState(readStoredRiskFilter);
  const [whenFilter, setWhenFilter] = useState(readStoredWhenFilter);
  const searchRef = useRef(null);
  const listRef = useRef(null);
  const markAllRef = useRef(null);
  const readerRef = useRef(null);

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
  const census = catalog?.census || { total: skills.length, unique: 0, duplicates: 0 };
  const linked = useMemo(
    () =>
      skills.filter(
        (s) =>
          matchesLinkFilter(s, linkFilter) &&
          matchesRiskFilter(s, riskFilter) &&
          matchesWhenFilter(s, whenFilter),
      ),
    [skills, linkFilter, riskFilter, whenFilter],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return linked.filter((s) => {
      if (scopeId !== "all" && s.scopeId !== scopeId) return false;
      return matchesQuery(s, q);
    });
  }, [linked, scopeId, query]);

  const markedCount = checked.size;
  const allVisibleMarked =
    visible.length > 0 && visible.every((s) => checked.has(s.id));

  useEffect(() => {
    const el = markAllRef.current;
    if (!el) return;
    const someVisibleMarked = visible.some((s) => checked.has(s.id));
    el.indeterminate = someVisibleMarked && !allVisibleMarked;
  }, [visible, checked, allVisibleMarked]);

  const scopeCounts = useMemo(() => {
    const by = new Map();
    for (const skill of linked) {
      by.set(skill.scopeId, (by.get(skill.scopeId) || 0) + 1);
    }
    return by;
  }, [linked]);

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
    if (!selectedId || !readerRef.current) return;
    if (window.matchMedia("(max-width: 960px)").matches) {
      readerRef.current.scrollIntoView({ block: "nearest" });
    }
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

  async function confirmDelete() {
    if (!slip) return;
    setBusy(true);
    setNotice("");
    try {
      const result = await deleteSkills(slip.ids);
      const n = result.deleted.length;
      setNotice(
        n
          ? `Deleted ${n} card${n === 1 ? "" : "s"} from disk.`
          : "Nothing was deleted.",
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
    const card = skills.find((s) => s.id === selectedId);
    const home = card?.skillRel || "SKILL.md";
    if (relPath === home || relPath === "SKILL.md") {
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
        <div className="mast-lead">
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
                placeholder="name, description, path, origin, frontmatter"
                type="search"
                spellCheck="false"
              />
            </label>
            <p className="keys">j k move · / find · x mark · d delete</p>
          </div>
        </div>
        <div className="mast-tools">
          <div className="census">
            <p>
              <b>{loading ? "…" : census.total}</b>
              <span>in house</span>
            </p>
            <p>
              <b>{loading ? "…" : census.unique}</b>
              <span>unique</span>
            </p>
            <p>
              <b>{loading ? "…" : census.duplicates}</b>
              <span>duplicates</span>
            </p>
          </div>
          <button type="button" className="reshelve" onClick={() => load(true)}>
            Reshelve
          </button>
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
            <em>{linked.length}</em>
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
              <em>{scopeCounts.get(scope.id) ?? 0}</em>
            </button>
          ))}
        </nav>

        <section className="tray" aria-label="Skills">
          <div className="tray-head">
            <label className="check">
              <input
                ref={markAllRef}
                type="checkbox"
                checked={allVisibleMarked}
                onChange={toggleVisible}
                aria-label="Mark all shown cards"
              />
              <span>
                {markedCount ? `${markedCount} marked` : `${visible.length} shown`}
              </span>
            </label>
            {markedCount > 0 ? (
              <button
                type="button"
                className="stamp"
                onClick={() => openSlip([...checked])}
              >
                Delete
              </button>
            ) : null}
            <div className="tray-filters">
              <LinkFilterSelect
                value={linkFilter}
                onChange={(next) => {
                  writeStoredLinkFilter(next);
                  setLinkFilter(next);
                }}
              />
              <RiskFilterSelect
                value={riskFilter}
                onChange={(next) => {
                  writeStoredRiskFilter(next);
                  setRiskFilter(next);
                }}
              />
              <WhenFilterSelect
                value={whenFilter}
                onChange={(next) => {
                  writeStoredWhenFilter(next);
                  setWhenFilter(next);
                }}
              />
            </div>
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
                    {formStamps(skill)}
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

        <main ref={readerRef} className="reader" aria-live="polite">
          {slip ? (
            <DeleteConfirm
              slip={slip}
              busy={busy}
              onCancel={() => setSlip(null)}
              onConfirm={confirmDelete}
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
              onSelectCopy={(id) => {
                setSlip(null);
                setSelectedId(id);
              }}
              onDelete={() => openSlip([selected.id])}
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

function DeleteConfirm({ slip, busy, onCancel, onConfirm }) {
  const builtin = slip.cards.filter((c) => c.kind !== "user");
  const unlinkCount = slip.cards.filter((c) => c.link).length;
  return (
    <div className="leaf slip">
      <p className="edition">Delete</p>
      <h2>
        Delete {slip.cards.length} card
        {slip.cards.length === 1 ? "" : "s"} from disk
      </h2>
      <p className="warning">
        There is no undo. Each card names its filesystem effect below.
      </p>
      {unlinkCount > 0 && (
        <p className="warning">
          Unlink removes the link only. The target stays.
        </p>
      )}
      {builtin.length > 0 && (
        <p className="warning">
          {builtin.length} of these live in a plugin cache or builtin drawer and
          may return the next time that tool updates.
        </p>
      )}
      <ol className="slip-list">
        {slip.cards.map((card) => {
          const effect = deleteEffect(card);
          return (
            <li key={card.id}>
              <strong>{card.name}</strong>
              <span className="effect">
                {effect.label}
              </span>
              <code title={effect.path}>{effect.path}</code>
              {effect.note ? <small>{effect.note}</small> : null}
            </li>
          );
        })}
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
          {busy ? "Deleting…" : "Delete"}
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
  onSelectCopy,
  onDelete,
}) {
  const fm = detail?.frontmatter || selected.frontmatter || {};
  const keys = Object.keys(fm);
  const files = detail?.files || [];
  const copies = (detail?.copies?.length ? detail.copies : selected.copies) || [];
  const findings = detail?.findings || selected.findings || [];
  const skillRel = selected.skillRel || "SKILL.md";
  const showDisk = true;
  const whenLabel =
    selected.invocation === "hook"
      ? "hook"
      : selected.invocation === "user"
        ? "user only"
        : "model may call";
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
          <p className="path" title={selected.path}>
            {selected.path}
          </p>
          <p className="stamps">
            <span data-kind={selected.kind}>{kindStamp(selected.kind)}</span>
            {formStamps(selected, { origin: "all" })}
            {detail ? <span>{formatBytes(detail.bytes)}</span> : null}
            <span>{formatWhen(selected.mtime)}</span>
          </p>
        </div>
        <button type="button" className="stamp" onClick={onDelete}>
          Delete this skill
        </button>
        <div className="leaf-tools">
          <div className="toggle">
            <button
              type="button"
              className={!preview && view === "manuscript" ? "on" : ""}
              onClick={() => {
                setView("manuscript");
                onOpenFile(skillRel);
              }}
            >
              Manuscript
            </button>
            <button
              type="button"
              className={!preview && view === "source" ? "on" : ""}
              onClick={() => {
                onOpenFile(skillRel);
                setView("source");
              }}
            >
              Source
            </button>
          </div>
        </div>
      </header>

      {showDisk && (
        <section className="catalogue">
          <h3>On disk</h3>
          <dl>
            <div>
              <dt>form</dt>
              <dd>{selected.file ? "file" : "folder"}</dd>
            </div>
            <div>
              <dt>when</dt>
              <dd>
                {whenLabel}
                {selected.invocationEvidence ? (
                  <code title={selected.invocationEvidence}>
                    {selected.invocationEvidence}
                  </code>
                ) : null}
              </dd>
            </div>
            {selected.link ? (
              <div>
                <dt>symlink</dt>
                <dd>{selected.linkTarget || "yes"}</dd>
              </div>
            ) : null}
            {selected.origin ? (
              <div>
                <dt>origin</dt>
                <dd>
                  <OriginLink origin={selected.origin} />
                </dd>
              </div>
            ) : null}
            {copies.length > 0 ? (
              <div>
                <dt>copies</dt>
                <dd>
                  <ul className="copy-list">
                    {copies.map((copy) => (
                      <li key={copy.id}>
                        <button
                          type="button"
                          onClick={() => onSelectCopy(copy.id)}
                        >
                          {copy.scopeLabel}
                        </button>
                        <code title={copy.path}>{copy.path}</code>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      )}

      {findings.length > 0 && (
        <section className="catalogue">
          <h3>Risk</h3>
          <dl>
            {findings.map((item, index) => (
              <div key={`${item.rule}-${item.file}-${item.line}-${index}`}>
                <dt data-risk={item.severity}>{item.severity}</dt>
                <dd>
                  {item.message}
                  <code title={`${item.file}:${item.line}`}>
                    {item.file}:{item.line} · {item.rule}
                  </code>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

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
                    (!preview && file.path === skillRel)
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
