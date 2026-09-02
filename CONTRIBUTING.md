# Contributing

Thanks for helping with Skill Cabinet. This is a local catalog for agent skills on disk. Keep the surface quiet, precise, and librarian: drawers, cards, a delete stamp. Quarantine sits beside Delete; it is not a second stamp.

## Setup

Node 20+.

```bash
git clone git@github.com:subsy/skill-cabinet.git
cd skill-cabinet
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The API binds to localhost only (`127.0.0.1:3781` by default).

```bash
npm run build
npm start
npm test
```

## Layout

- `src/` Vite + React UI
- `server/` scan and HTTP API
- `bin/skill-cabinet.js` production entry
- `PRODUCT.md` users, tone, and design principles
- `DESIGN.md` surfaces, named rules, and anti-patterns

## Pull requests

- One concern per PR.
- Match the existing copy: library language, not startup language. Destructive actions say **Delete**.
- Do not bind the server to a public interface.
- Do not commit secrets, `.env` files, or `dist/`.
- `npm run build` and `npm test` should succeed.

Open an issue first for large scans, new skill roots, or destructive-path changes.

## License

Contributions are MIT. See [LICENSE](LICENSE).
