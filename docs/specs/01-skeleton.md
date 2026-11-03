# 01: Project skeleton

Part of milestone 1 (see [decisions.md](../decisions.md)). Status: done (2026-11-03).

## Spec

### Goal
An empty but working app that every later feature plugs into: one command runs it, one command tests it, and it runs the same way in a Podman container.

### Must have
- npm workspaces monorepo, TypeScript everywhere:
  - `packages/engine`: the sorting engine. Has no web or server dependencies, so the future Obsidian plugin can reuse it.
  - `apps/server`: Node 22 + Hono, one process. Opens the SQLite database with sqlite-vec loaded.
  - `apps/web`: React + Vite frontend, served by the server.
- `npm start`: builds everything and starts the app on http://127.0.0.1:3000.
- `npm test`: type-checks every package, then runs all tests with Vitest. Exits non-zero on any failure.
- `GET /api/health` returns `{ status, version, sqlite, sqliteVec }`, proving the database and vector extension work.
- The web page shows the app name and the health result.
- First real engine code: `resolveEndpoint(url)`, which turns what the user types in the Settings URL field into the exact API URL. It accepts a full endpoint (`.../openai/v1/responses` or `.../chat/completions`) or a base URL (`.../openai/v1` with or without a trailing slash).
- Configuration through environment variables: `PORT` (default 3000), `HOST` (default 127.0.0.1), `AUTONOTE_DATA_DIR` (default `./data`).
- Container: `Containerfile` + `compose.yaml`, run with `podman-compose up --build`. The company root certificate is passed in when the `CORP_CA_FILE` setting points to it (for `npm ci` during the build and for HTTPS calls at runtime). Without it, the container still builds and runs on a normal network.
- `.gitignore` for `node_modules`, build output, `data/` and `.env`.
- `README.md` with what AutoNote is and the run/test commands. `AGENTS.md` gains a "Commands" section.

### Constraints
- Listen on 127.0.0.1 only by default: there is no login yet, so the app must not be reachable from the network. The container binds to all interfaces inside the container, but the compose file publishes the port on 127.0.0.1 only.
- Only packages from the npm registry (no downloads from GitHub releases or nodejs.org).
- Node 22.22 from Ubuntu can't run `.ts` files directly, so the server is compiled to JavaScript before it runs.
- Integer IDs bound to `node:sqlite` must be BigInt.

### Out of scope
- Login, quick capture, sorting, Settings UI, PWA manifest (the next specs).
- A hot-reload dev mode.

### Done when
- `npm test` passes.
- `npm start` serves the page, and `/api/health` reports the SQLite and sqlite-vec versions.
- `podman-compose up --build` builds on the office network and serves the same page and health result.

### Result
- `npm test`: type check passes for all three packages; 19 tests pass.
- `npm start`: serves the page on 127.0.0.1:3000; health reports SQLite 3.46.1 and sqlite-vec v0.1.9.
- Container: builds on the office network with the certificate; runs as the non-root `node` user, published on 127.0.0.1 only; HTTPS to Azure Foundry works from inside; also starts with no certificate configured. Uses `network_mode: pasta`, because Podman bridge networks fail on the WSL kernel. The official Node image bundles SQLite 3.53.4.

## Plan

1. Root files: `package.json` (workspaces, `start`/`test`/`build`/`typecheck` scripts), `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`.
2. `packages/engine`: `resolveEndpoint` with tests.
3. `apps/server`: config from environment variables, database module (open SQLite, load sqlite-vec), Hono app with `/api/health` and static file serving for the web build, entry point. Tests for the database module and the health route, using an in-memory database.
4. `apps/web`: Vite + React page that calls `/api/health`.
5. Build: `vite build` for the web app; `vite build --ssr` bundles the server (and the engine it imports) into one JavaScript file; `tsc` type-checks each package.
6. Run `npm install`, `npm test`, `npm start`, and check the page and health endpoint.
7. Container: `Containerfile` (multi-stage, `node:22-slim` via the mirror, certificate as a build secret, runs as non-root), `compose.yaml`, `.env.example`. Build and run it with Podman and check the health endpoint.
8. Docs: `README.md`, Commands section in `AGENTS.md`, mark this spec done.
9. Ship: commit and push.
