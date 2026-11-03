# 04: Quick capture and sorting v1

Part of milestone 1 (see [decisions.md](../decisions.md)). Status: done (2026-11-03), tested with the fake provider; not yet run against gpt6-luna.

## Spec

### Goal
The core loop: type anything into one box, and AutoNote splits it into pieces, files each piece as a Markdown note in a topic folder, and shows where everything went, with undo.

### Behavior
- **Home** is the capture box: a large text field and a **Save** button (Ctrl/Cmd+Enter also saves). Saving is instant; sorting happens in the background.
- The original text is always kept, as a Markdown file in the archive, before any AI call.
- **Activity** (below the box) lists recent captures, newest first. Each shows a preview, its status, and once sorted, each piece as "Title → Topic/Path", with a **new topic** tag when sorting created that topic and an **unsure** tag when the model's confidence is below 0.6. **Show** expands a piece to show the note text.
- Statuses: *Sorting…*, *Filed*, *Waiting for an AI connection* (no active connection; a banner links to Settings), *Failed* (with the reason and a **Retry** button), *Undone*.
- When a connection is added or switched, waiting captures are sorted automatically.
- **Undo** removes the capture's notes, and any topic folders that sorting created and that are now empty. The original stays in the archive.
- The page refreshes the feed by itself while anything is still sorting.
- New topic names use the language of the browser (for example Thai on a Thai phone). Note content stays in its original language.

### Sorting engine (engine package)
- One AI call per capture splits it into pieces and, for each piece, returns a title, a lightly cleaned-up body, a topic path and a confidence. The model sees the existing topic paths (up to the 200 most recently used) so it reuses them; a smarter local shortlist comes with search.
- The reply must be JSON. If it can't be used, the engine asks once more, quoting the problem; a second failure marks the capture *Failed*.
- Topic paths from the model are cleaned before use: at most 4 levels, no characters that are invalid in file names, no hidden or reserved folders (leading `.` or `_`), so the model can never write outside the vault. They match existing topics regardless of case. An empty result goes to `Inbox`.
- Token usage is saved per capture, for cost tracking.

### Files (Obsidian-compatible)
Each org has its own vault folder: `<data dir>/vaults/<org id>/`.
- Original: `_archive/2026/11/2026-11-03 1540 ab12cd34.md`, with the original text and frontmatter (`id`, `captured`).
- Note: `<Topic/Path>/<Title>.md` (" 2", " 3", … added when the name is taken), with frontmatter `id`, `title`, `topic`, `created`, `source` (a `[[wikilink]]` to the original), then the body.

### API
- `POST /api/captures` with `{ text, language }` → the capture (status *queued*). Up to 100,000 characters.
- `GET /api/captures` → the 30 most recent captures with their pieces, and `hasConnection`.
- `POST /api/captures/:id/undo`, `POST /api/captures/:id/retry`.
- `GET /api/notes/:id` → `{ id, title, topic, markdown }`.

### Data
Migration 3: `captures` (text, language, status, error, archive path, token counts, times), `topics` (org, path, which capture created it), `notes` (org, capture, topic, title, file path, confidence).

### Out of scope (next specs)
- "Ask when unsure" mode with approval of low-confidence pieces; "Full auto" toggle.
- Plain-language corrections ("this belongs in Travel"), moving notes, learning from corrections.
- Entities and links between notes; images, voice, links, PDFs; editing notes.
- Cutting gigantic captures into sections before sorting.

### Done when
- `npm test` passes: engine tests (prompt, reply parsing, retry, path cleaning), server tests (queue, files on disk, undo, retry, waiting, org isolation) and a browser test of the whole loop on phone and desktop, using the fake provider.
- Screenshots reviewed.

### Result
- `npm test`: 101 unit tests and 24 browser tests pass (the whole loop in light and dark mode, phone and desktop, including the files on disk).
- Found while building: tokens from failed sorting attempts were not counted (fixed: errors carry usage); a race in the queue could leave a capture unsorted (fixed); connection order was random within the same millisecond (fixed).
- Visual review: "New org created." stayed on screen forever (now hidden after the first capture or leaving Home); token counts were misaligned with buttons (fixed).

## Plan
1. Engine: `sortCapture`, reply parsing and validation, `cleanTopicPath`, `noteFileName`, Markdown rendering with frontmatter. Tests.
2. Server: migration 3; vault file helpers; capture store; background sort queue (resumes unfinished captures on startup); routes; hook so new or switched connections resume waiting captures. Tests.
3. Fake provider: answer sorting requests deterministically (split on blank lines, topic by keyword, invalid JSON on request).
4. Web: capture box, activity feed with polling, banner, Undo/Retry/Show. The health info moves to Settings.
5. Browser test of the loop; check files on disk; screenshots.
6. `npm test`, restart the app on port 3000, ship.
