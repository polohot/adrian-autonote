# 05: Left menu and Pending

Status: done (2026-11-03).

## Spec

### Goal
The app gets its long-term layout (Chat, Add Notes, Pending, Settings), and the AI asks before storing a piece it isn't sure about.

### Menu
- Desktop and tablet (720 px and wider): a menu on the left with **Chat**, **Add Notes**, **Pending** (with a count badge when something is waiting), and **Settings** at the bottom.
- Phones: the same four items as a bottom tab bar.
- **Add Notes** is today's Home screen (capture box and activity feed) and stays the start page.
- **Chat** shows a short "coming next" page until the Chat spec. The Graph item is added with the Graph spec, not as a placeholder now.
- **Sign out** moves to Settings.

### When a piece goes to Pending
- The sorting reply gets two optional fields per piece: `question` (a short question for the user, in the user's language) and `choices` (2–3 topic paths). The model is told to ask whenever its confidence is below 0.7 or the right topic depends on something only the user knows.
- A piece goes to Pending when it has a question, or its confidence is below 0.6. If the model gave no question, the app asks "Where should this go?" with the suggested topic as the choice.
- Pending pieces are not written to the vault. Confident pieces of the same capture are stored right away.
- In the activity feed, a capture with waiting pieces shows "1 waiting in Pending" with a link.

### Answering
Each Pending item shows the capture it came from, the piece's title and text, the AI's question, and:
- **Choice buttons**: one per choice (the suggested topic first). Tapping files the piece there.
- **A text box** to answer in your own words. The AI reads the answer and picks the topic (one AI call); the piece is then filed.
- **Don't save**: drops the piece. The original stays in the archive.

Filed pieces then appear in the activity feed like any other piece. Undo on a capture also removes its Pending pieces.

### API
- `GET /api/pending` → `{ items: [{ id, captureId, capturePreview, title, body, suggestedTopic, confidence, question, choices, createdAt }] }`
- `POST /api/pending/:id/choose` with `{ topic }` → the filed piece
- `POST /api/pending/:id/answer` with `{ answer }` → the filed piece, or `{ error }` if the AI call failed (the item stays in Pending)
- `DELETE /api/pending/:id` → 204
- `GET /api/captures` items gain `pendingCount`.

### Data
Migration 4: `pending_pieces(id, org_id, capture_id, title, body, suggested_topic, confidence, question, choices JSON, created_at)`.

### Out of scope
- Learning from answers (later, with corrections in Chat).
- A setting to switch to "Full auto".

### Done when
- `npm test` passes: engine tests for the new reply fields and for answer resolution; server tests for routing to Pending, choose, answer, don't save, undo and org isolation; browser tests for the menu on phone and desktop and the whole Pending flow, with screenshots reviewed in light and dark mode.
- One real run with gpt6-luna on an ambiguous capture.

### Result
- `npm test`: 119 unit tests and 36 browser tests pass (menu on phone and desktop, the whole Pending flow, in light and dark mode).
- Found while building: two quick taps on choices could file a piece twice (fixed: a piece is claimed before filing); the left menu was taller than the screen because padding was added to 100% height (fixed with border-box sizing everywhere).
- Visual review: the "From:" line repeated the whole capture (now one line, cut off with "…"); "Don't save" wrapped onto two lines (fixed).
- Real gpt6-luna: clear notes are filed directly (563 tokens for 3 pieces, existing topics reused). Ambiguous notes all went to Pending with good questions and choices, for example "Does 'พี่' refer to a family member or a work colleague/senior?" with Family or Work/Documents.

## Plan
1. Engine: `question`/`choices` in the sorting prompt and parser; `fileWithAnswer` (one AI call that picks a topic from the user's answer). Tests.
2. Server: migration 4; Pending store; sorter sends unsure pieces to Pending; shared "file a piece" step used by sorting and Pending; routes; undo clears Pending. Tests.
3. Fake provider: questions for ambiguous text; answer resolution by keyword.
4. Web: layout with left menu and bottom tab bar; Pending page; feed link; Chat placeholder; Sign out in Settings.
5. Browser tests; visual check in light and dark mode; one real run with gpt6-luna; ship.
