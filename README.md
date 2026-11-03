# AutoNote

Quick-capture notes that sort themselves. Type, paste or share anything into one box; AutoNote splits it into pieces, files each piece into a topic, and links related notes. Everything is stored as plain, Obsidian-compatible Markdown.

Status: early development. Nothing user-facing works yet beyond the server health page.

## Requirements

- Node.js 22.12 or newer
- Optional: Podman and podman-compose for running in a container

## Run

```bash
npm install
npm start
```

Then open http://127.0.0.1:3000. The app listens on localhost only. Data is stored in `./data` (change with `AUTONOTE_DATA_DIR`).

## Test

```bash
npm test
```

Type-checks every package, then runs all tests.

## Run in a container

```bash
podman-compose up --build -d
```

On a network that inspects TLS (company firewall), copy `.env.example` to `.env` and set `CORP_CA_FILE` to the company root certificate first.

## Project layout

- `packages/engine`: the sorting engine, free of web and server code so other front ends (such as an Obsidian plugin) can reuse it
- `apps/server`: Node + Hono server with SQLite and sqlite-vec
- `apps/web`: React + Vite web app
- `docs/`: planning handoff, decisions and specs

## License

[AGPL-3.0](LICENSE)
