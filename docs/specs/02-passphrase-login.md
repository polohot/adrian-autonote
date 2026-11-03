# 02: Passphrase login

Part of milestone 1 (see [decisions.md](../decisions.md)). Status: done (2026-11-03).

## Spec

### Goal
Only people who know an org's passphrase can use the app. Entering a passphrase signs you into the org that uses it, or creates that org if none does.

### Behavior
- The login screen has one passphrase field and a "Continue" button. Any length is allowed (at least one character), with no strength rules or warnings. The only limit is a 10,000-character safety cap against oversized requests.
- The same passphrase always opens the same org. A passphrase that no org uses yet creates a new org immediately; the next screen shows a small "New org created" note.
- Before matching, the passphrase is normalized so the same words typed on different devices match: Unicode NFC (Thai and accented text can be encoded more than one way), and leading/trailing whitespace removed (phone keyboards add trailing spaces). Case still matters. The field turns off auto-capitalize, auto-correct and spell check.
- After signing in you stay signed in for 90 days since your last visit. "Sign out" ends the session on that device only.
- All API routes need a session except `GET /api/health` and the login route itself.

### Security
- Only a slow hash of the passphrase is stored: scrypt (built into Node, so nothing to download) with N=2^15, r=8, p=1, 32-byte output. Because the passphrase must identify the org, every org shares one random server salt, generated on first start and stored in the database.
- At most 10 login attempts per client IP address per 10 minutes; more get HTTP 429 with a "try again in N minutes" message.
- Session token: 32 random bytes in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` when served over HTTPS). Only a SHA-256 hash of the token is stored.
- State-changing requests from other websites are rejected (Origin check), so another site can't sign you in or out.
- The health endpoint reveals nothing about orgs.

### API
- `POST /api/session` with `{ "passphrase": "..." }` returns `{ org: { id, createdAt }, created }` and sets the cookie.
- `GET /api/session` returns `{ org }`, or 401 when not signed in.
- `DELETE /api/session` signs out (204).

### Data
Schema versions are tracked with SQLite's `user_version`; each schema change is a numbered migration that runs on startup.
- `meta(key, value)`: holds the server salt.
- `orgs(id, passphrase_hash unique, created_at)`.
- `sessions(token_hash, org_id → orgs, created_at, expires_at)`.

### Out of scope
- Changing an org's passphrase, naming orgs, telling apart people within one org.
- Reaching the app from the phone (Tailscale): the default is still localhost only.

### Done when
- `npm test` passes, with tests for normalization, hashing, sign-in to an existing org, creating a new org, sessions and expiry, sign-out, protected routes, rate limiting and the Origin check.
- In the browser: the passphrase creates an org, a reload keeps you signed in, sign out returns to the login screen, and the same passphrase opens the same org again.

### Result
- `npm test`: 50 tests pass (31 new for login).
- Browser check (Playwright headless Chromium against a real server): login screen, "New org created" note, reload keeps the session, sign out, and the same passphrase (with surrounding spaces removed) opens the same org; the cookie is HttpOnly and SameSite=Lax. The database file contains only the hash, not the passphrase.

## Plan

1. Migrations runner in `db.ts`; migration 1 creates `meta`, `orgs`, `sessions`.
2. `auth/passphrase.ts`: normalize and hash (scrypt with the server salt, created on first use).
3. `auth/sessions.ts`: create, look up (sliding 90-day expiry), delete.
4. `auth/rate-limit.ts`: in-memory fixed-window limiter keyed by client IP.
5. `auth/routes.ts`: the three `/api/session` routes; `requireSession` middleware for every other `/api/*` route; Origin check for non-GET requests.
6. Tests for each module and the routes.
7. Web: login screen, "New org created" note, sign-out button; the health info stays on the main screen.
8. Run `npm test`, then check the flow in a real browser.
9. Update decisions and `AGENTS.md` if anything changes; mark this spec done; commit and push.
