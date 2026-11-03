# Decisions

Answers to the open questions in [planning-handoff.md](planning-handoff.md).

## 2026-11-03

- **Phone:** both Android and iPhone from day one. The Android share target and the iPhone Shortcut are both v1.
- **AI budget:** no fixed monthly budget yet. Track tokens and cost per note so a budget can be set from real numbers.
- **First chat model:** gpt6-luna on an Azure AI Foundry deployment (reachable on the office network).
- **Login:** a single passphrase per org, any length, no strength warnings. The passphrase identifies the org: anyone who enters the same passphrase joins the same org. The server stores only a slow hash (never the passphrase) and rate-limits attempts. Notes are not end-to-end encrypted, because the AI processes them on the server.
- **Tech stack:** TypeScript everywhere, as an npm workspaces monorepo.
  - Sorting engine in its own package so a future Obsidian plugin can reuse it.
  - Backend: Node 22 + Hono, one process.
  - Database: built-in `node:sqlite` + `sqlite-vec` (both from the npm registry; avoids `better-sqlite3`, whose prebuilt binaries come from GitHub releases, which the office network blocks). To be verified during project setup.
  - Frontend: React + Vite + PWA plugin.
  - Word splitting for Thai/Chinese/Japanese: built-in `Intl.Segmenter`.
  - Tests: Vitest.
  - To check: whether Hugging Face model downloads (for local embeddings) are reachable on the office network.
- **Hosting:** public GitHub repo, https://github.com/polohot/adrian-autonote (HTTPS, sign-in through Windows Git Credential Manager). Office-network details in the docs are published as-is, by choice.
- **License:** AGPL-3.0-only, free for everyone. The app must show users a link to its source code (AGPL section 13), e.g. a "Source" link in the UI.
- **Deferred:** final default embedding model (after the growth test); Node 26 upgrade (off the office network).
