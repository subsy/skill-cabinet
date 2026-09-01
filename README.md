# Skill Cabinet

<img src="public/logo.svg" alt="Skill Cabinet logo" width="64" height="64">

A local catalog for agent skills installed on your machine. It scans user-level drawers such as `.agents`, `.claude`, `.codex`, `.cursor` (including plugins), and other `~/.* /skills` folders, lets you read each skill and its frontmatter, and can archive or delete skill folders from disk.

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

- Filter by drawer and search name, description, path, origin, or frontmatter
- Filter symlink cards: all, only, or hide
- Read the skill body (rendered or source), YAML frontmatter, and extra files
- See whether a skill is a folder, a file, or a symlink
- Follow a GitHub origin when the skill names it, or when the install path encodes it. Origins taken from a parent plugin or git remote are marked inferred.
- Archive one skill or several at once, and restore them later
- Delete one skill or several at once
- Switch skins from the Theme menu (Carbon is the default)

**Archive** moves the skill out of its drawer and into `~/.skill-cabinet/archive/<drawer>/`. Your agents stop loading it, because no agent reads that folder, but the copy is kept. Archived skills get their own drawer at the bottom of the list, outside the count of what is installed. **Restore** puts one back at the exact path it came from; if something is already there, the archived copy stays where it is and tells you.

A symlinked skill is archived as a link, so the repository it points at is never touched. Archiving the same skill twice keeps both copies.

**Delete** removes the skill from disk (folder, file, or link). There is no undo. Builtin Cursor skills and plugin-cache copies may come back the next time that tool updates, whether you archive them or delete them.

Keys: `j`/`k` move, `/` find, `x` mark, `a` archive, `r` restore, `d` delete.

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

Tests run on the Node test runner, with no extra dependencies:

```bash
npm test
```

## License

[MIT](LICENSE)
