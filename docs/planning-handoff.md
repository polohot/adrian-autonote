# AutoNote: planning handoff, 2026-11-03

## Product
- Personal tool first (owner: polohot), designed so it can be shared or sold later.
- Own app first: web app + installable PWA on the phone from day one. Later: Obsidian plugin and others, reusing the same "sorting engine".
- Storage: plain Markdown files with [[wikilinks]] and YAML frontmatter, Obsidian-compatible. Attachments in their own folder with explicit paths.
- Home screen is a quick-capture box; a full Markdown editor is also available.
- Inputs v1: text, images, voice, web links, PDFs/documents, Android share target, iPhone Shortcut (iOS PWAs cannot be share targets). Email forwarding only after the cloud move.
- Sorting engine: splits mixed notes into pieces, rewrites each piece, files it into a topic, extracts entities (people, places, projects, organizations), and adds links. Do all of this in one AI call per piece.
  - Modes: "Ask when unsure" (default, confidence threshold) and "Full auto".
  - New topics: created automatically when confident; asks for approval when unsure.
  - Activity feed shows where every piece went, with undo.
  - Plain-language corrections ("this belongs in Travel", or an explicit path like a/b/c). The AI learns from corrections.
  - Originals are always kept in an archive and linked from every piece.
  - When the user edits a note: update links and index, then suggest a move (never move it automatically). The user can chat with the suggestion.
  - One assistant handles corrections, suggestions and questions, and can move/split/merge/rename notes and topics.
- Images: a vision model describes the image and extracts its text; that text is saved in the note and embedded. Multimodal image embeddings are an optional later layer.
- Languages: multilingual. Content stays in its original language. Topics have stable IDs plus a display name in the user's language (default: browser/phone language). Translation on demand; a setting can force one language. Keyword search needs a word splitter for Thai/Chinese/Japanese.
- Retrieval: search box (keyword + vector + graph-link boost), chat with cited sources, proactive related notes plus daily/weekly digest, browse by topic tree or graph.
- Graph: switchable views (notes only / notes + topics / notes + topics + entities). Never draw all nodes at once at large scale: show clusters, expand on zoom, render with WebGL.

## AI providers
- Any OpenAI-compatible endpoint: URL + key + model (OpenAI, DeepSeek, Kimi, OpenRouter, Ollama, LM Studio, Azure AI Foundry). Native Claude/Gemini adapters optional.
- Azure AI Foundry v1: base URL https://<resource>.openai.azure.com/openai/v1/, model = deployment name. Support Microsoft Entra ID sign-in later.
- Connection profiles (e.g. "Work: Azure Foundry", "Personal: others"). Manual switch plus auto-fallback based on reachability. Settings can be per notebook (keep work data on company resources, personal data on personal keys).
- Separate settings for chat, vision, transcription (Whisper-compatible) and embeddings.
- Embeddings: default is an optional local multilingual model on CPU (e.g. EmbeddingGemma-300M). The embedding model must be the same on every network. Record which model made each vector; provide a "rebuild index" button. Embed paragraphs, not whole files. Small vectors (256-768 dims), compressed.

## Scale and testing
- Never send the whole vault to the AI: a local search shortlists candidate topics, then only short summaries of the top 5-10 go to the model.
- A gigantic single note is cut into sections before sorting.
- Growth test: generated note collection with known correct topics, including messy mixed Thai/English notes, multi-topic dumps, near-duplicates, screenshots and voice memos. Add in batches of 100 / 1k / 10k / 100k. Measure filing accuracy, retrieval accuracy (recall@k), tokens and cost per note, response time, RAM/disk, topic-tree health (duplicates, depth, single-note topics), correction rate over time, and whether the graph opens at 100k.

## Runtime and deployment
- Phase 1: runs on the PC inside WSL; the phone connects through Tailscale. Phase 2: small cloud server, target 1-2 GB RAM.
- One app process + SQLite + sqlite-vec. Incremental indexing in a background queue with a memory cap.
- Containers: Podman only, never Docker (licensing). Containerfile + podman-compose.

## Rules for coding agents (copy into AGENTS.md)
- Use Podman and podman-compose for all container work. Never use Docker or Docker Desktop.
- There must be one command to run the app and one command to run the tests; the growth/eval harness is the measure of whether a change helped.
- When giving the user setup instructions, give one step at a time and wait for the result.
- Office network: TLS is inspected by a Check Point firewall. The company root certificate (Autoliv Root) is installed in WSL; env vars NODE_EXTRA_CA_CERTS, SSL_CERT_FILE, REQUESTS_CA_BUNDLE and UV_NATIVE_TLS are set in /etc/profile.d/corporate-ca.sh (sourced from ~/.bashrc). Containers that call HTTPS on the office network need this certificate passed in.
- Blocked on the office network: nodejs.org, download.docker.com, the Docker Hub download CDN, objects.githubusercontent.com (GitHub release downloads), api.openai.com, api.anthropic.com, api.deepseek.com. Reachable: npm registry, PyPI, GitHub (git over HTTPS), Ubuntu apt, Gemini API, mirror.gcr.io, quay.io, mcr.microsoft.com. Do not try to bypass the firewall; use Azure Foundry or Gemini at the office.
- docker.io images are pulled via mirror.gcr.io (configured in ~/.config/containers/registries.conf.d/50-docker-hub-mirror.conf).

## Dev environment (done)
- WSL distro adrian-autonote at C:\WSL\adrian-autonote (from the June autoliv-base backup). Ubuntu 26.04, user polohot, systemd on, boot command "mount --make-rshared /".
- Git 2.53 (polohot / polohot@gmail.com, default branch main). Node 22.22.1 from Ubuntu + npm 11.21.1. nvm 0.40.8 installed but unused (nodejs.org blocked). Python 3.14.4. Podman 5.7, podman-compose 1.5, buildah.
- Project folder: ~/projects/adrian-autonote (empty, not yet a Git repo). Code lives on the Linux filesystem, not /mnt/c.
- Cursor opens this folder from Windows PowerShell with: cursor --remote wsl+adrian-autonote /home/polohot/projects/adrian-autonote
- Known issue: Windows interop is broken in this distro ("Exec format error" when running .exe files, e.g. `cursor .` from WSL). Likely systemd-binfmt resetting the WSLInterop registration.
- No hosted repo yet; create it later (HTTPS, since SSH may be blocked at the office) and set up Git sign-in.

## Open questions
- iPhone or Android?
- Monthly AI budget?
- Login/security for the app (needed even for personal use, since it's reachable over Tailscale).
- Tech stack (default proposal: TypeScript web app).
- Final default embedding model, after testing.
- Upgrade to Node 26 when off the office network.

## Next steps
1. git init, save this handoff, create AGENTS.md.
2. Fix WSL interop.
3. Create the hosted repo and set up Git sign-in.
4. Continue planning (open questions), then start building.
5. Optional: export the configured distro as a new base backup.
