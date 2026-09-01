import { useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import YAML from "yaml";
import {
  fetchCatalog,
  fetchSkill,
  fetchSkillFile,
  deleteSkills,
  archiveSkills,
  restoreSkills,
} from "./api.js";
import Logo from "./Logo.jsx";
import {
  LINK_FILTERS,
  THEMES,
  applyTheme,
  matchesLinkFilter,
  readStoredLinkFilter,
  readStoredTheme,
  writeStoredLinkFilter,
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
    skill.fromScope || "",
    skill.archived ? "archived archive" : "",
    skill.file ? "file" : "",
    skill.link ? "symlink link" : "",
    skill.linkTarget || "",
    skill.origin?.label || "",
    skill.origin?.url || "",
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
  if (kind === "archive") return "archived";
  return "user";
}

// The three shelf actions. Each names its own copy so the confirmation slip and
// the buttons cannot drift apart, and so only delete wears the stamp: archive
// and restore are reversible and should not read as destruction.
const ACTIONS = {
  delete: {
    label: "Delete",
    edition: "Delete",
    run: deleteSkills,
    key: "deleted",
    destructive: true,
    heading: (n) => `Delete ${n} card${n === 1 ? "" : "s"} from disk`,
    note: () => "This deletes the skill from the local filesystem. There is no undo.",
    busy: "Deleting…",
    done: (n) => `Deleted ${n} card${n === 1 ? "" : "s"} from disk.`,
    none: "Nothing was deleted.",
  },
  archive: {
    label: "Archive",
    edition: "Archive",
    run: archiveSkills,
    key: "archived",
    destructive: false,
    heading: (n) => `Archive ${n} card${n === 1 ? "" : "s"} out of the drawers`,
    note: (where) => (
      <>
        The cards move to <code>{where}</code>. No agent reads that folder.
        Restore puts them back where they came from.
      </>
    ),
    busy: "Archiving…",
    done: (n) => `Archived ${n} card${n === 1 ? "" : "s"}.`,
    none: "Nothing was archived.",
  },
  restore: {
    label: "Restore",
    edition: "Restore",
    run: restoreSkills,
    key: "restored",
    destructive: false,
    heading: (n) => `Restore ${n} card${n === 1 ? "" : "s"} to their drawers`,
    note: () =>
      "Each card goes back to the path it was filed from. A card whose path is already taken stays in the archive.",
    busy: "Restoring…",
    done: (n) => `Restored ${n} card${n === 1 ? "" : "s"}.`,
    none: "Nothing was restored.",
  },
};

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
    <label className="theme-select link-filter">
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
  const searchRef = useRef(null);
  const listRef = useRef(null);
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
  const archiveRoot = catalog?.archiveRoot || "the archive";
  const inArchive = scopeId === "archive";
  const filtered = useMemo(
    () => skills.filter((s) => matchesLinkFilter(s, linkFilter)),
    [skills, linkFilter],
  );
  // Archived cards are held out of the drawer counts on purpose: they are not
  // installed any more, so counting them would overstate what the agents load.
  const live = useMemo(() => filtered.filter((s) => !s.archived), [filtered]);
  const archived = useMemo(() => filtered.filter((s) => s.archived), [filtered]);
  const drawerScopes = useMemo(
    () => scopes.filter((s) => s.id !== "archive"),
    [scopes],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = inArchive ? archived : live;
    return pool.filter((s) => {
      if (!inArchive && scopeId !== "all" && s.scopeId !== scopeId) return false;
      return matchesQuery(s, q);
    });
  }, [live, archived, inArchive, scopeId, query]);

  const scopeCounts = useMemo(() => {
    const by = new Map();
    for (const skill of live) {
      by.set(skill.scopeId, (by.get(skill.scopeId) || 0) + 1);
    }
    return by;
  }, [live]);

  useEffect(() => {
    if (busy) return;
    if (!visible.length) {
      setSelectedId(null);
      return;
    }
    if (!visible.some((s) => s.id === selectedId)) {
      setSelectedId(visible[0].id);
    }
  }, [visible, selectedId, busy]);

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
        openSlip(marked(), "delete");
      }
      if (e.key === "a" && !slip && !inArchive) {
        e.preventDefault();
        openSlip(marked(), "archive");
      }
      if (e.key === "r" && !slip && inArchive) {
        e.preventDefault();
        openSlip(marked(), "restore");
      }
      if (e.key === "Escape" && slip) {
        setSlip(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selectedId, checked, slip, inArchive]);

  // A bare selection counts as one marked card, so every action works without
  // ticking a box first.
  function marked() {
    if (checked.size) return [...checked];
    return selectedId ? [selectedId] : [];
  }

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

  function openSlip(ids, mode) {
    if (!ids.length) return;
    const cards = ids
      .map((id) => skills.find((s) => s.id === id))
      .filter(Boolean);
    setSlip({ ids, cards, mode });
  }

  async function confirmSlip() {
    if (!slip) return;
    const action = ACTIONS[slip.mode];
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const result = await action.run(slip.ids);
      const n = result[action.key]?.length ?? 0;
      setNotice(n ? action.done(n) : action.none);
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
          <p className="keys">
            j k move · / find · x mark · a archive · r restore · d delete
          </p>
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
            <em>{live.length}</em>
          </button>
          {drawerScopes.map((scope) => (
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
          <button
            type="button"
            className={inArchive ? "drawer archive on" : "drawer archive"}
            onClick={() => {
              setSlip(null);
              setScopeId("archive");
            }}
            title={`Held out of every drawer an agent reads · ${archiveRoot}`}
          >
            <i data-kind="archive" />
            <span>Archive</span>
            <em>{archived.length}</em>
          </button>
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
            <LinkFilterSelect
              value={linkFilter}
              onChange={(next) => {
                writeStoredLinkFilter(next);
                setLinkFilter(next);
              }}
            />
            <div className="tray-actions">
              <button
                type="button"
                className="shelve"
                disabled={!checked.size && !selectedId}
                onClick={() => openSlip(marked(), inArchive ? "restore" : "archive")}
              >
                {inArchive ? "Restore" : "Archive"}
              </button>
              <button
                type="button"
                className="stamp"
                disabled={!checked.size && !selectedId}
                onClick={() => openSlip(marked(), "delete")}
              >
                Delete
              </button>
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
                    {skill.archived && skill.fromScope ? (
                      <span data-from>from {skill.fromScope}</span>
                    ) : null}
                    {formStamps(skill)}
                    <time>{formatWhen(skill.mtime)}</time>
                  </p>
                </article>
              </li>
            ))}
            {!loading && !visible.length && (
              <li className="empty-tray">
                {inArchive && !query
                  ? "The archive is empty. Archive a skill to keep a copy no agent reads."
                  : `No cards in this drawer${query ? " match the search." : "."}`}
              </li>
            )}
          </ol>
        </section>

        <main ref={readerRef} className="reader" aria-live="polite">
          {slip ? (
            <ActionSlip
              slip={slip}
              busy={busy}
              archiveRoot={archiveRoot}
              onCancel={() => setSlip(null)}
              onConfirm={confirmSlip}
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
              onAction={(mode) => openSlip([selected.id], mode)}
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

function ActionSlip({ slip, busy, archiveRoot, onCancel, onConfirm }) {
  const action = ACTIONS[slip.mode];
  const count = slip.cards.length;
  // A plugin cache or builtin drawer is written by the tool that owns it, so
  // taking a card out of one is only as permanent as that tool's next update.
  // That is true of archiving as much as deleting.
  const managed = slip.cards.filter((card) => card.kind !== "user");
  return (
    <div className="leaf slip">
      <p className="edition">{action.edition}</p>
      <h2>{action.heading(count)}</h2>
      <p className={action.destructive ? "warning" : "aside"}>
        {action.note(archiveRoot)}
      </p>
      {managed.length > 0 && slip.mode !== "restore" && (
        <p className="warning">
          {managed.length} of these live in a plugin cache or builtin drawer and
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
          className={action.destructive ? "stamp" : "shelve"}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? action.busy : action.label}
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
  onAction,
}) {
  const fm = detail?.frontmatter || selected.frontmatter || {};
  const keys = Object.keys(fm);
  const files = detail?.files || [];
  const skillRel = selected.skillRel || "SKILL.md";
  const showDisk =
    selected.file || selected.link || selected.origin || selected.archived;
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
            {selected.archived && selected.fromScope ? (
              <span data-from>from {selected.fromScope}</span>
            ) : null}
            {formStamps(selected, { origin: "all" })}
            {detail ? <span>{formatBytes(detail.bytes)}</span> : null}
            <span>{formatWhen(selected.mtime)}</span>
          </p>
        </div>
        <div className="leaf-actions">
          <button
            type="button"
            className="shelve"
            onClick={() => onAction(selected.archived ? "restore" : "archive")}
          >
            {selected.archived ? "Restore" : "Archive"}
          </button>
          <button
            type="button"
            className="stamp"
            onClick={() => onAction("delete")}
          >
            Delete
          </button>
        </div>
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
            {detail?.archivedFrom ? (
              <div>
                <dt>restores to</dt>
                <dd>{detail.archivedFrom}</dd>
              </div>
            ) : null}
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
