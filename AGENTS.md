# AGENTS.md

Rules for coding agents working on AutoNote. Full project context: [docs/planning-handoff.md](docs/planning-handoff.md).

- Use Podman and podman-compose for all container work. Never use Docker or Docker Desktop.
- There must be one command to run the app and one command to run the tests; the growth/eval harness is the measure of whether a change helped.
- When giving the user setup instructions, give one step at a time and wait for the result.
- Office network: TLS is inspected by a Check Point firewall. The company root certificate (Autoliv Root) is installed in WSL; env vars NODE_EXTRA_CA_CERTS, SSL_CERT_FILE, REQUESTS_CA_BUNDLE and UV_NATIVE_TLS are set in /etc/profile.d/corporate-ca.sh (sourced from ~/.bashrc). Containers that call HTTPS on the office network need this certificate passed in.
- Blocked on the office network: nodejs.org, download.docker.com, the Docker Hub download CDN, objects.githubusercontent.com (GitHub release downloads), api.openai.com, api.anthropic.com, api.deepseek.com. Reachable: npm registry, PyPI, GitHub (git over HTTPS), Ubuntu apt, Gemini API, mirror.gcr.io, quay.io, mcr.microsoft.com. Do not try to bypass the firewall; use Azure Foundry or Gemini at the office.
- docker.io images are pulled via mirror.gcr.io (configured in ~/.config/containers/registries.conf.d/50-docker-hub-mirror.conf).
