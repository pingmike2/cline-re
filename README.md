# cline-re

A clean-room reimplementation of the [Cline](https://cline.bot) CLI agent
(v3.0.74), built by reverse-engineering the published npm artifacts and the
open-source `cline/cline` repository.

No Cline code is vendored. The binary is never patched or decrypted — every
protocol constant below was derived from observable behaviour (HTTP traffic,
TypeScript declaration files, and the open-source app shell), then re-expressed
in ~2.6k lines of dependency-free ESM.

```
$ cline-re -m solar-mini4 "read app.js — is add() correct?"
[iteration 2] No.
--- completed after 4 iteration(s) ---
No. app.js defines `add(a,b){ return a-b }`, subtracting instead of adding.
```

---

## Why this exists

The official CLI ships as a ~53 MB (arm64) / 155 MB (x64) Bun single-file
executable. Newer builds embed an **encrypted bytecode asset block** — the JS
sources are not extractable from the trailer (`---- Bun! ----`), so static
extraction is a dead end.

Instead this project reconstructs the agent from three legitimate surfaces:

1. **The npm launcher chain** — `cline` → `@cline/cli-linux-{x64,arm64}` →
   `@cline/core` / `@cline/agents` / `@cline/shared` / `@cline/llms`, whose
   `.d.ts` files fully describe the runtime contracts.
2. **The open-source app shell** — `apps/cli/src/{index,main}.ts` on `master`
   at the same version (3.0.74), which pins the exact `Bun.isStandaloneExecutable`
   entry logic.
3. **Live HTTP observation** — the auth and inference protocol, derived from
   traffic produced by an authenticated session.

The result is a working agent that uses a **real Cline account** and its
**free model pool**, with no browser, no Electron, and no bundled runtime.

---

## Findings

### Distribution

| Layer | Package | Size | Notes |
|---|---|---|---|
| Launcher | `cline` | 48 KB | 6-line `spawn` shim, picks platform binary |
| Binary | `@cline/cli-linux-arm64` | 53 MB | Bun standalone, `bin/cline` |
| Binary | `@cline/cli-linux-x64` | 155 MB | same, x64 |
| SDK | `@cline/core` | 27 MB | orchestrator, tools, prompt assembly |
| SDK | `@cline/agents` | — | single-turn tool loop (`AgentRuntime`) |
| SDK | `@cline/shared` | — | protocol types |
| SDK | `@cline/llms` | — | Vercel AI SDK multi-provider adapter |

`apps/cli/package.json` on `master` is version **3.0.74** — identical to the
npm release, so the open-source shell matches the shipped binary.

### Tool surface

Nine tool definitions are registered in `@cline/core`, but the `terminal`
surface activates five for non-interactive runs:

| Tool | Purpose |
|---|---|
| `read_files` | Batch file reads, path + line-range |
| `editor` | Create / replace / insert into files |
| `run_commands` | Shell execution (gated by plan-mode analysis) |
| `search_codebase` | Regex search with glob filters |
| `fetch_web_content` | URL fetch → markdown |

Aliases are resolved through a small mapping table, so model output using
either the canonical name or an alias lands on the same handler.

### Auth protocol

Cline uses **WorkOS Device Authorization** for the CLI:

```
POST https://api.workos.com/user_management/authorize/device
  → { device_code, user_code, verification_uri }
  browser: https://authkit.cline.bot/device?user_code=XXXX-XXXX
POST https://api.workos.com/user_management/authenticate
  { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code }
  → { access_token, refresh_token, ... }
```

Two details matter and are easy to get wrong:

- **The `access_token` is not sent raw.** Every inference request uses
  `Authorization: Bearer workos:<access_token>`. Omitting the `workos:` prefix
  yields `401`.
- **Refresh is Cline's own endpoint**, not WorkOS:
  `POST https://api.cline.bot/api/v1/auth/refresh` with
  `{ refreshToken, grantType: "refresh_token" }` (camelCase).

Credentials land in `~/.cline-re/credentials.json` with mode `600`, and are
rewritten in place after every rotation (60 s early-refresh margin).

### Client fingerprint

The gateway rejects requests that do not look like the official client. These
headers are required, not cosmetic:

```
Authorization: Bearer workos:<token>
User-Agent: Cline/3.0.74
HTTP-Referer: https://cline.bot
X-Title: Cline
X-IS-MULTIROOT: false
X-CLIENT-TYPE: cline-sdk
X-CLIENT-VERSION: 3.0.74
X-PLATFORM: terminal
X-PLATFORM-VERSION: 3.0.74
X-CORE-VERSION: 0.0.66
X-Task-ID: <session id>
```

Dropping the `X-*` set produces `403 ... is only available via Cline product
surfaces`.

### Model tiers

`GET /ai/cline/recommended-models` returns three disjoint branches:

| Branch | Usable via API | Reason |
|---|---|---|
| `data.free` (`cline-free/*`) | **yes** | free quota, no credits |
| `data.clineCloud/*` | **no** — 403 | Cloud Agents browser sandbox only |
| `data.clinePass/*` | no — 403 | requires paid ClinePass ($9.99/mo) |

The `cline-cloud/*` 403 is not a header problem: the official CLI sends the
identical fingerprint with the same token and is rejected the same way. Those
routes are bound to the hosted sandbox session, not to the account.

Free models reachable through the API:

```
solar-mini4                 → cline-free/solar-mini4
nemotron                    → cline-free/nemotron-3.5-super-vl
lightning                   → nvidia/nemotron-3.5-lightning-free
laguna                      → poolside/laguna-s-2.1-free
beam                        → reflection/beam-free
```

---

## What was rebuilt vs. what was not

**Rebuilt (the interesting part):**

- **Plan-mode command guard** — six static rule tables (135 entries) ported
  from the official `TP()` analysis: shell wrappers (11), shell keywords (15),
  file mutators (47), git writers (22), package writers (17), and write
  subcommands (23). Covers redirection (`>`, `>>`), in-place edits (`sed -i`,
  `tee`), destructive finds (`-delete`), `git commit`, package installs, and
  so on. Writes are only permitted into `/tmp` and `/dev/null`.
- **Loop guardrail** — the same tool with the same input triggers a warning on
  the 3rd occurrence and a hard stop on the 5th.
- **Mistake guardrail** — N consecutive tool failures abort the run.
- **Git checkpoints** — snapshots under
  `refs/cline/checkpoints/<sessionId>/<runCount>`, restorable per run.
- **Session persistence** — JSONL transcripts, resumable by id.
- **Agent loop** — streaming SSE assembly, partial tool-call accumulation,
  parallel tool dispatch, and per-iteration event emission.

**Deliberately not rebuilt:**

- The Electron/webview UI, MCP host, terminal-rendering layer.
- The cloud task sync and telemetry paths.
- `cline-cloud/*` and `clinePass/*` model tiers (unreachable by design).

---

## Install

```bash
git clone <this-repo> && cd cline-re
npm install        # no runtime deps, only links the bin
npm link           # or: ln -s "$PWD/src/cli.js" /usr/local/bin/cline-re
```

Requires Node 20+ (uses `node:test`, ESM, `AbortSignal.timeout`).

## Usage

```bash
cline-re login                      # browser pairing (device code)
cline-re whoami
cline-re models

cline-re "fix the failing test"                     # act mode
cline-re -p "plan a refactor, don't touch anything" # plan mode (read-only)
cline-re -y "run the full suite"                    # headless/background
cline-re -m nemotron "summarise this repo"
cline-re --checkpoints "migrate to ESM"
cline-re --sessions
cline-re -r <session-id> "continue"
```

| Flag | Meaning |
|---|---|
| `-p, --plan` | read-only; command guard blocks mutations |
| `-y, --yolo` | headless, auto-approve |
| `-m, --model` | model id or alias |
| `-c, --cwd` | working directory |
| `-k, --key` | API key instead of account login |
| `--checkpoints` | git snapshot before each run |
| `--session` / `-r` | name or resume a session |
| `--json` | machine-readable event stream |
| `--max-iterations` | hard cap per run |
| `--retries` | consecutive-mistake budget |

### Using it as a library

```js
import { createAgent, clineGatewayHeaders } from "cline-re";

const agent = createAgent({ model: "cline-free/solar-mini4", cwd: process.cwd() });
for await (const ev of agent.run("add a test for mul()")) {
  if (ev.type === "text") process.stdout.write(ev.delta);
}
```

---

## Tests

```bash
npm test     # 86 tests, node:test, fully offline
```

The suite covers the agent loop, credentials refresh/rotation, session
persistence, checkpoint restore, the plan guard rule tables, loop and
mistake trackers, and an end-to-end run against a local mock server.

Live smoke tests (require a signed-in account, **not** part of `npm test`):

```bash
node test/live-free.mjs
```

## Layout

```
src/
  cli.js              argument parsing, command dispatch, rendering
  index.js            public entry (createAgent, header helpers)
  agent.js            the agent loop: stream → tool calls → results
  llm.js              SSE client for the OpenAI-compatible gateway
  tools.js            registry + alias resolution
  tool-read.js        read_files
  tool-editor.js      editor
  tool-run.js         run_commands
  tool-search.js      search_codebase
  plan-guard.js       static shell rule tables (plan mode)
  guardrails.js       loop + mistake trackers
  checkpoint.js       git ref snapshots
  session.js          JSONL transcripts, dataDir
  credentials.js      token cache, 600-mode atomic rewrite
  cline-auth-api.js   /auth/refresh exchange
  auth.js             WorkOS device flow
  login.js            pairing UX
  prompt*.js          system prompts (act / plan / yolo)
```

## Notes on the encryption

Bun's standalone format appends the module table after a `---- Bun! ----`
trailer. In Cline ≥ 3.0.x this table is stored as an **encrypted asset block**
rather than plaintext JavaScript, so `strings`, trailer carving, and known
module-graph reconstruction all fail. Anything claiming to "unpack" the binary
is either running it under a debugger or reading the open-source tree — there
is no static path. This project takes the open-source + protocol route instead.

## Legal

For research and interoperability. You are responsible for complying with
Cline's Terms of Service when using your own account. No credentials, tokens, or
account data are included in this repository. `WORKOS_CLIENT_ID` in `src/auth.js`
is Cline's **public** OAuth client id, which is by design embedded in
browser-visible clients.
