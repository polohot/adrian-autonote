# Decisions

Answers to the open questions in [planning-handoff.md](planning-handoff.md).

## 2026-11-03

- **Phone:** both Android and iPhone from day one. The Android share target and the iPhone Shortcut are both v1.
- **AI budget:** no fixed monthly budget yet. Track tokens and cost per note so a budget can be set from real numbers.
- **First chat model:** gpt6-luna on an Azure AI Foundry deployment (reachable on the office network).
- **Login:** a single passphrase per org, any length, no strength warnings. The passphrase identifies the org: anyone who enters the same passphrase joins the same org. The server stores only a slow hash (never the passphrase) and rate-limits attempts. Notes are not end-to-end encrypted, because the AI processes them on the server.
  - A passphrase no org uses creates a new org immediately (no confirmation), followed by a "New org created" note.
  - Matching ignores surrounding whitespace and Unicode encoding differences (NFC); case matters. Safety cap of 10,000 characters.
  - Sessions last 90 days since last use; sign-out is per device. Details: [specs/02-passphrase-login.md](specs/02-passphrase-login.md).
- **Tech stack:** TypeScript everywhere, as an npm workspaces monorepo.
  - Sorting engine in its own package so a future Obsidian plugin can reuse it.
  - Backend: Node 22 + Hono, one process.
  - Database: built-in `node:sqlite` + `sqlite-vec` (both from the npm registry; avoids `better-sqlite3`, whose prebuilt binaries come from GitHub releases, which the office network blocks). To be verified during project setup.
  - Frontend: React + Vite + PWA plugin.
  - Word splitting for Thai/Chinese/Japanese: built-in `Intl.Segmenter`.
  - Tests: Vitest.
  - Verified on the office network: `sqlite-vec` 0.1.9 installs from npm and loads into `node:sqlite` (SQLite 3.46.1 on Node 22.22.1); vector search and FTS5 work. Integer IDs must be bound as BigInt (`1n`), because `node:sqlite` binds JS numbers as floats. Node prints an ExperimentalWarning for `node:sqlite`.
  - To check: whether Hugging Face model downloads (for local embeddings) are reachable on the office network.
- **Hosting:** public GitHub repo, https://github.com/polohot/adrian-autonote (HTTPS, sign-in through Windows Git Credential Manager). Office-network details in the docs are published as-is, by choice.
- **License:** AGPL-3.0-only, free for everyone. The app must show users a link to its source code (AGPL section 13), e.g. a "Source" link in the UI.
- **Milestone 1:** project skeleton (one run command, one test command, Containerfile), passphrase login, quick-capture box (phone and PC), sorting engine filing text notes into Markdown topics with gpt6-luna, activity feed with undo, and a Settings screen for AI connection profiles.
- **AI connection settings:** entered in the Settings UI, not in files. URL, API key and model can be changed anytime; multiple profiles with switching. Settings belong to the org, so everyone in the org shares the connection. The key is stored server-side and never sent back to the browser in full (only the last few characters are shown).
- **AI API format:** support the OpenAI Responses API (`/openai/v1/responses`) as well as Chat Completions. Azure Foundry resources can be on `*.services.ai.azure.com` as well as `*.openai.azure.com`. The Settings URL field accepts either a full endpoint URL or a base URL ending in `/openai/v1/`. The first Foundry endpoint was verified reachable from the office network (returns 401 without a key).
- **Navigation:** a left menu with **Chat**, **Add Notes** and **Pending**, and Settings at the bottom. On phones it becomes a bottom tab bar.
- **Pending ("Ask when unsure"):** a piece goes to Pending, and is not stored, when the AI has a specific question for the user (it writes the question and 2–3 topic choices) or its confidence is low. The user taps a choice or answers in their own words in a text box. Pieces of the same capture that the AI is sure about are stored right away.
- **Chat v1:** answers questions about the notes with links to the sources, and carries out commands such as "move this to Travel". Search is built as part of it.
- **Build order:** left menu and Pending, then search, then Chat, then the Graph view.
- **Graph view (queued):** an Obsidian-style knowledge graph as its own **Graph** item in the left menu, following the handoff (switchable views; clusters that expand on zoom; WebGL). The first version links notes, topics and the captures they came from; entities and note-to-note links are added once sorting extracts them.
- **Deferred:** final default embedding model (after the growth test); Node 26 upgrade (off the office network).
