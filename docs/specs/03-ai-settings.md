# 03: AI connection settings

Part of milestone 1 (see [decisions.md](../decisions.md)). Status: done, except the real Azure Foundry check, which needs the user's key.

## Spec

### Goal
You can enter, test and switch AI connections in the app, so the sorting engine (next spec) knows which model to call. Nothing about the AI connection lives in files.

### Behavior
- Signed-in pages get a small menu: **Home** and **Settings**.
- Settings lists the org's connection profiles. Each shows its name, URL, model, the last 4 characters of the key, and an "Active" badge on the one in use.
- **Add connection** form: Name (e.g. "Work: Azure Foundry"), URL, Model (the deployment name on Azure), API key, and API style (Auto / Responses / Chat Completions). Under the URL field, the app shows the exact address it will call ("Will call: …"), worked out by `resolveEndpoint` while you type. An invalid URL shows why and blocks saving.
- **Edit**: same form; leaving the key blank keeps the current key.
- **Test**: sends one tiny request ("Reply with OK") with the saved settings and shows the result: success with the reply and response time, or the error the provider returned (for example "401: invalid subscription key").
- **Use this one** makes a profile active. The first profile you add becomes active automatically. Deleting the active profile leaves none active.
- **Delete** asks for confirmation first.
- Profiles belong to the org: everyone with the passphrase sees and uses the same ones. Another org never sees them.

### AI client (engine package)
- `generateText(connection, { instructions, input })` calls either the Responses API or Chat Completions and returns the text plus token usage. It lives in the engine so the future Obsidian plugin can reuse it.
- Sends the key as `Authorization: Bearer …`, plus an `api-key` header for Azure hosts.
- Times out after 60 seconds. Errors carry the HTTP status and the provider's message.

### Security
- The API key is never sent back to the browser, only its last 4 characters.
- The key is stored in the database file, which only the server reads. Encrypting it at rest is a possible later step.
- All profile routes need a session and only touch the signed-in org's profiles.

### API
- `GET /api/ai-profiles` → `{ profiles: [{ id, name, url, api, model, keyHint, active }] }`
- `POST /api/ai-profiles` → the new profile
- `PATCH /api/ai-profiles/:id` → the updated profile (fields optional; empty `apiKey` keeps the key)
- `DELETE /api/ai-profiles/:id` → 204
- `POST /api/ai-profiles/:id/activate` → 204
- `POST /api/ai-profiles/:id/test` → `{ ok: true, reply, latencyMs }` or `{ ok: false, error }`

`api` is `"auto"`, `"responses"` or `"chat-completions"`.

### Data
Migration 2: `ai_profiles(id, org_id → orgs, name, url, api, model, api_key, created_at, updated_at)` and `org_settings(org_id → orgs, active_ai_profile_id → ai_profiles)`.

### Out of scope
- Separate models for vision, transcription and embeddings (added with those features).
- Automatic fallback between profiles based on reachability.
- Microsoft Entra ID sign-in.

### Done when
- `npm test` passes, including unit tests for `generateText` against a fake provider, the profile routes (including org isolation and key hiding), and a browser test that adds, tests, edits, switches and deletes profiles on phone and desktop screens. The browser test uses a small fake OpenAI-compatible server, so it needs no real key.
- A real test against the Azure Foundry endpoint succeeds once you enter your key.

### Result
- `npm test`: 68 unit tests and 8 browser tests pass (Settings flow and menu on phone and desktop, using the fake provider in `e2e/fake-ai.mjs`).
- Screenshot review found cramped connection cards (title touching the URL row); fixed with spacing.
- The fake provider uses port 3199: in this WSL setup, the port right after a running server (3101 next to 3100) is redirected to that server.

## Plan
1. Engine: `generateText` with Responses and Chat Completions support; unit tests with a fake `fetch`.
2. Server: migration 2; `ai/profiles.ts` (create, list, update, delete, activate, get active); routes; unit tests.
3. Fake AI server for browser tests (`e2e/fake-ai.ts`), started by Playwright next to the app.
4. Web: hash-based menu (Home / Settings), Settings page with the profile list and form, live "Will call" preview.
5. Browser test for the whole Settings flow; screenshots.
6. Run `npm test`; restart the app on port 3000 so you can try it; ship.
