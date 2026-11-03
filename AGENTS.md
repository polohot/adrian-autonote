# AGENTS.md

Rules for coding agents working on AutoNote. Full project context: [docs/planning-handoff.md](docs/planning-handoff.md). Decisions made since: [docs/decisions.md](docs/decisions.md).

## Commands

- Run the app: `npm start` (builds, then serves http://127.0.0.1:3000)
- Run the tests: `npm test` (type check, Vitest unit tests, then Playwright browser tests on a phone and a desktop screen)
- Only unit tests: `npm run test:unit`. Only browser tests: `npm run test:e2e`.
- Run in a container: `podman-compose up --build -d`

## Workflow

- Work in this order: spec, plan, build, test, ship. Specs and plans live in `docs/specs/`; shipping means commit and push.
- Record new decisions in `docs/decisions.md`.
- Every user-facing feature gets a Playwright test in `e2e/` that clicks through it like a user. Tests save screenshots to `e2e/screenshots/` (ignored by Git) through the `screenshot` helper, which also fails on unreadable text (contrast below 4.5:1, or no explicit page background).
- Every build ends with a visual check: open the screenshots for light and dark mode, phone and desktop, look at them yourself, and show the relevant ones to the user. Passing tests alone don't count as checked.
- Cursor's built-in browser is disabled by the company admin on this account; use Playwright for browser work.

## Rules

- Use Podman and podman-compose for all container work. Never use Docker or Docker Desktop.
- There must be one command to run the app and one command to run the tests; the growth/eval harness is the measure of whether a change helped.
- When giving the user setup instructions, give one step at a time and wait for the result.
- Office network: TLS is inspected by a Check Point firewall. The company root certificate (Autoliv Root) is installed in WSL; env vars NODE_EXTRA_CA_CERTS, SSL_CERT_FILE, REQUESTS_CA_BUNDLE and UV_NATIVE_TLS are set in /etc/profile.d/corporate-ca.sh (sourced from ~/.bashrc). Containers that call HTTPS on the office network need this certificate passed in.
- Blocked on the office network: nodejs.org, download.docker.com, the Docker Hub download CDN, objects.githubusercontent.com (GitHub release downloads), api.openai.com, api.anthropic.com, api.deepseek.com. Reachable: npm registry, PyPI, GitHub (git over HTTPS), Ubuntu apt, Gemini API, mirror.gcr.io, quay.io, mcr.microsoft.com. Do not try to bypass the firewall; use Azure Foundry or Gemini at the office.
- docker.io images are pulled via mirror.gcr.io (configured in ~/.config/containers/registries.conf.d/50-docker-hub-mirror.conf).
- Podman bridge networks fail in this WSL distro (netavark: "nft did not return successfully while applying ruleset"). Use `network_mode: pasta` in compose files; default `podman run` networking works.
- Ubuntu's Node 22 is built without TypeScript support, so `.ts` files can't be run with `node` directly. The server is bundled with `vite build --ssr`; tests run through Vitest.
- `node:sqlite` binds JS numbers as floats; bind integer IDs as BigInt (`1n`).
