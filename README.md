# Skill Cabinet

<img src="public/logo.svg" alt="Skill Cabinet logo" width="64" height="64">

A local catalog for agent skills installed on your machine. It scans user-level drawers such as `.agents`, `.claude`, `.codex`, `.cursor` (including plugins), Hermes profiles, and other `~/.* /skills` folders, lets you read each skill and its frontmatter, and can delete or quarantine skill folders from disk.

<img src="docs/images/cabinet.jpg" alt="Skill Cabinet: drawers, index cards, and a skill on the reading desk" width="960">

## This fork

Local extensions to the scanner, all in `server/scan.js`:

- Generic `~/.*` drawers are scanned deep, so drawers that nest skills by category (`skills/<category>/<skill>/SKILL.md`, e.g. Hermes, ghcp-appmod) are picked up like flat ones.
- Additional roots: `.hermes/plugins`, `.grok/bundled/skills`, `.config/opencode/node_modules`, `.gemini/config/plugins`, `.gemini/antigravity-cli` and `.gemini/antigravity-ide` (builtins + IDE plugins), `.local/share/mimocode/builtin_skills`.
- More loose docs ignored: `readme.es.md`, `readme.ko.md`, `description.md`, `security.md`, `contributing.md`, `pull_request_template.md`, `access.md`, `benchmark.md`.
- Deliberately **not** scanned: `.grok/marketplace-cache` — hashed checkouts of marketplace *catalogs* (xai `plugin-marketplace`, anthropics `claude-plugins-official`), not skills an agent reads.

## Run

```bash
npx skill-cabinet
```

That starts a local server on `127.0.0.1` (port `3781` by default) and opens it in your browser. Bind only happens on localhost.

```bash
# from this repo instead of the npm package
npx github:subsy/skill-cabinet
```

```bash
# keep the current tab
SKILL_CABINET_NO_OPEN=1 npx skill-cabinet

# pick a port
PORT=4000 npx skill-cabinet
```

Requires Node 20+.

## What it can do

- Filter by drawer and search name, description, path, origin, copies, or frontmatter
- Filter form: all, physical, references, or broken
- Filter risk: all, elevated, or hide
- Filter invocation: all, user only, model, hook, or off
- Read the skill body (rendered or source), YAML frontmatter, and extra files
- See whether a skill is a folder, a file, or a symlink
- Follow a GitHub origin when the skill names it, or when the install path encodes it. Origins taken from a parent plugin or git remote are marked inferred.
- Notice identical copies across drawers, virtual references, and broken links, and static risk in the skill body
- Read the house census: what occupies disk, what merely points at it, and the bytes the duplicates occupy
- Quarantine a skill out of every drawer an agent reads (`~/.skill-cabinet/quarantine`). Restore puts it back.
- Delete one skill or several at once. A symlink is unlinked; its target stays.
- Switch skins from the Theme menu (Carbon is the default)

**Delete** removes the skill from disk (folder, file, or link). There is no undo. Builtin Cursor skills and plugin-cache copies may come back the next time that tool updates.

**Quarantine** moves the skill off the live drawers without destroying it. It does not wear the delete stamp.

Keys: `j`/`k` move, `/` find, `x` mark, `q` quarantine, `r` restore, `d` delete.

## Develop

See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
git clone git@github.com:subsy/skill-cabinet.git
cd skill-cabinet
npm install
npm run dev
```

Then open [http://127.0.0.1:5173](http://127.0.0.1:5173). Production mode after a build:

```bash
npm run build
npm start
```

## License

[MIT](LICENSE)
