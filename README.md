# cline-re

[English](#cline-re) · [简体中文](#中文说明)

A clean-room reimplementation of the [Cline](https://cline.bot) CLI agent
(v3.0.74), built by reverse-engineering the published npm artifacts and the
open-source `cline/cline` repository.

See [NOTES.md](NOTES.md) for the reverse-engineering log: how the binary was
ruled out, the two protocol details that are easy to get wrong, the plan-mode
bug found during testing, and what a real-repo audit got right and wrong.

No Cline code is vendored. The binary is never patched or decrypted — every
protocol constant below was derived from observable behaviour (HTTP traffic,
TypeScript declaration files, and the open-source app shell), then re-expressed
in ~1.9k lines of dependency-free ESM.

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
  so on. Writes are only permitted into `/tmp` and `/dev/null` — except under
  the worktree itself, which stays read-only even when the project happens to
  live under `/tmp`.
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

## DeepSeek Harness plugin

`dsh/` wraps this repo as a DSH plugin with two independently switchable halves:

- a **`cline` model provider** so DSH's own agent loop can run Cline's free models, and
- a **`cline` tool** that delegates a self-contained task to the cline-re agent here.

The API key is filled in DSH → Settings → Plugins → `dsh-cline` → Configure (a
browser half renders and saves it), and read from `config.apiKey` (that form),
`<DSH_HOME>/cline.json` (hot-reloaded), `CLINE_API_KEY`, or `cline-re login` — in
that order, so people can drop their own key in without touching the plugin. See [dsh/README.md](dsh/README.md) for the install steps,
the audit surface, and the known limitations (notably: DSH's Models settings page
does not render key inputs for custom providers, which is why the Configure page
and the key file exist).

---

## Tests

```bash
npm test     # 109 tests, node:test, fully offline (90 core + 19 plugin)
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


## License

MIT — see [LICENSE](LICENSE). Cline, WorkOS and model names belong to their
respective owners; this repository contains no Cline code, binary, or vendor
asset, and is not affiliated with or endorsed by Cline.

---

# 中文说明

[English](#cline-re) · [简体中文](#中文说明)

## 这是什么

[Cline](https://cline.bot) CLI agent（v3.0.74）的净室重实现：通过逆向公开的 npm
产物与开源的 `cline/cline` 仓库重建出来的。

逆向过程记录在 [NOTES.md](NOTES.md)：为什么排除二进制、两个最容易搞错的协议
细节、测试中发现的 plan 模式 bug，以及"凭真实仓库做审计"时对和错的地方。

本项目不内置任何 Cline 代码。二进制既不打补丁也不解密——下面每个协议常量都来自
可观测行为（HTTP 流量、TypeScript 声明文件、开源 app shell），再用约 1.9k 行零
依赖 ESM 重新表达。

```
$ cline-re -m solar-mini4 "读一下 app.js，add() 对吗？"
[iteration 2] No.
--- completed after 4 iteration(s) ---
No. app.js defines `add(a,b){ return a-b }`, subtracting instead of adding.
```

## 为什么做这个

官方 CLI 是 ~53 MB（arm64）/ 155 MB（x64）的 Bun 单文件可执行程序。新版把 JS
源码放进了**加密的字节码资产块**（`---- Bun! ----` 之后），静态提取走不通。

所以这个项目从三个合法面重建 agent：

1. **npm 启动链**：`cline` → `@cline/cli-linux-{x64,arm64}` → `@cline/core` /
   `@cline/agents` / `@cline/shared` / `@cline/llms`，它们的 `.d.ts` 完整描述了
   运行时契约。
2. **开源 app shell**：`master` 上同版本（3.0.74）的
   `apps/cli/src/{index,main}.ts`，钉死了 `Bun.isStandaloneExecutable` 的入口逻辑。
3. **真实 HTTP 观测**：登录与推理协议，来自已认证会话产生的流量。

结果是一个能用**真实 Cline 账号**和**免费模型池**的 agent，没有浏览器、没有
Electron、不打包运行时。

## 发现

### 分发包

| 层 | 包 | 大小 | 说明 |
|---|---|---|---|
| 启动器 | `cline` | 48 KB | 6 行 `spawn` 壳，按平台选二进制 |
| 二进制 | `@cline/cli-linux-arm64` | 53 MB | Bun standalone，`bin/cline` |
| 二进制 | `@cline/cli-linux-x64` | 155 MB | 同上，x64 |
| SDK | `@cline/core` | 27 MB | 编排器、工具、提示词组装 |
| SDK | `@cline/agents` | — | 单轮工具循环（`AgentRuntime`） |
| SDK | `@cline/shared` | — | 协议类型 |
| SDK | `@cline/llms` | — | Vercel AI SDK 多供应商适配 |

`master` 上 `apps/cli/package.json` 的版本是 **3.0.74**，与 npm 发布一致，说明
开源 shell 与发布的二进制对得上。

### 工具面

`@cline/core` 里注册了九个工具定义，但 `terminal` 面在非交互运行只启用五个：

| 工具 | 作用 |
|---|---|
| `read_files` | 批量读文件，支持路径 + 行范围 |
| `editor` | 新建 / 替换 / 插入文件内容 |
| `run_commands` | 执行 shell（受 plan 模式分析约束） |
| `search_codebase` | 带 glob 过滤的正则搜索 |
| `fetch_web_content` | 抓 URL → markdown |

别名走一张小映射表，模型输出规范名或别名都会落到同一个处理器。

### 认证协议

Cline 的 CLI 用 **WorkOS Device Authorization**：

```
POST https://api.workos.com/user_management/authorize/device
  → { device_code, user_code, verification_uri }
  浏览器：https://authkit.cline.bot/device?user_code=XXXX-XXXX
POST https://api.workos.com/user_management/authenticate
  { grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code }
  → { access_token, refresh_token, ... }
```

两个细节最容易错：

- **`access_token` 不是原样发送的。** 每个推理请求都用
  `Authorization: Bearer workos:<access_token>`；漏掉 `workos:` 前缀会得到 `401`。
- **刷新走 Cline 自己的端点**，不是 WorkOS：
  `POST https://api.cline.bot/api/v1/auth/refresh`，body 为
  `{ refreshToken, grantType: "refresh_token" }`（驼峰）。

凭据落在 `~/.cline-re/credentials.json`，权限 `600`，每次轮换后原地重写
（提前 60 秒刷新）。

### 客户端指纹

网关会拒绝"不像官方客户端"的请求。这些头是必需的，不是装饰：

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

去掉 `X-*` 会得到 `403 ... is only available via Cline product surfaces`。

### 模型层级

`GET /ai/cline/recommended-models` 返回三个互不相交的分支：

| 分支 | API 可用 | 原因 |
|---|---|---|
| `data.free`（`cline-free/*`） | **可以** | 免费额度，不扣积分 |
| `data.clineCloud/*` | **不行** — 403 | 仅 Cloud Agents 浏览器沙箱 |
| `data.clinePass/*` | 不行 — 403 | 需要付费 ClinePass（$9.99/月） |

`cline-cloud/*` 的 403 不是请求头问题：官方 CLI 用同样的指纹和同一个 token 也是
一样被拒。那些路由绑定在托管沙箱会话上，不绑定账号。

API 可达的免费模型：

```
solar-mini4                 → cline-free/solar-mini4
nemotron                    → cline-free/nemotron-3.5-super-vl
lightning                   → nvidia/nemotron-3.5-lightning-free
laguna                      → poolside/laguna-s-2.1-free
beam                        → reflection/beam-free
```

## 重建了什么 / 没重建什么

**重建了（有意思的部分）：**

- **plan 模式命令护栏**——六张静态规则表（135 条），从官方 `TP()` 分析移植：
  shell 包装器（11）、shell 关键字（15）、文件修改器（47）、git 写入（22）、
  包管理器写入（17）、写入子命令（23）。覆盖重定向（`>`、`>>`）、原地编辑
  （`sed -i`、`tee`）、破坏性 find（`-delete`）、`git commit`、装包等等。
  只允许写入 `/tmp` 与 `/dev/null`——但工作树自身例外地保持只读，哪怕项目刚好
  位于 `/tmp` 下。
- **循环护栏**——同工具同参数第 3 次告警，第 5 次硬停。
- **错误护栏**——连续 N 次工具失败即中止。
- **Git 检查点**——快照在 `refs/cline/checkpoints/<sessionId>/<runCount>`，
  可按 run 还原。
- **会话持久化**——JSONL 记录，可按 id 续跑。
- **Agent 循环**——SSE 流式拼装、部分 tool-call 累积、并行工具分发、逐轮事件。

**刻意没重建：**

- Electron/webview UI、MCP host、终端渲染层。
- 云任务同步与遥测。
- `cline-cloud/*` 与 `clinePass/*` 模型层级（设计上不可达）。

## 安装

```bash
git clone <this-repo> && cd cline-re
npm install        # 无运行时依赖，只链接可执行文件
npm link           # 或：ln -s "$PWD/src/cli.js" /usr/local/bin/cline-re
```

需要 Node 20+（用到 `node:test`、ESM、`AbortSignal.timeout`）。

## 用法

```bash
cline-re login                      # 浏览器配对（设备码）
cline-re whoami
cline-re models

cline-re "修一下失败的测试"                     # act 模式
cline-re -p "规划一次重构，先别动代码"           # plan 模式（只读）
cline-re -y "跑完整套件"                        # 无头/后台
cline-re -m nemotron "总结这个仓库"
cline-re --checkpoints "迁移到 ESM"
cline-re --sessions
cline-re -r <session-id> "继续"
```

| 参数 | 含义 |
|---|---|
| `-p, --plan` | 只读；命令护栏拦截写操作 |
| `-y, --yolo` | 无头、自动批准 |
| `-m, --model` | 模型 id 或别名 |
| `-c, --cwd` | 工作目录 |
| `-k, --key` | 直接用 API key，而不是账号登录 |
| `--checkpoints` | 每次运行前打 git 快照 |
| `--session` / `-r` | 命名或续跑会话 |
| `--json` | 机器可读的事件流 |
| `--max-iterations` | 单次运行硬上限 |
| `--retries` | 连续错误预算 |

### 当库用

```js
import { createAgent, clineGatewayHeaders } from "cline-re";

const agent = createAgent({ model: "cline-free/solar-mini4", cwd: process.cwd() });
for await (const ev of agent.run("给 mul() 加个测试")) {
  if (ev.type === "text") process.stdout.write(ev.delta);
}
```

## DeepSeek Harness 插件

`dsh/` 把这个仓库包成 DSH 插件，两半可独立开关：

- **`cline` 模型供应商**：DSH 自己的 agent 循环直接跑 Cline 免费模型；
- **`cline` 工具**：把一段自包含任务委派给这里的 cline-re agent。

API key 在 **DSH → 设置 → 插件 → `dsh-cline` → Configure** 里填（浏览器半边
渲染并保存），查找顺序为 `config.apiKey`（表单）→ `<DSH_HOME>/cline.json`
（热读）→ `CLINE_API_KEY` → `cline-re login`。这样别人填自己的 key 就行，不用
改插件代码。安装步骤、审核面和已知限制见 [dsh/README.md](dsh/README.md)
（其中一条：DSH 的 Models 设置页不给自定义供应商渲染 key 输入框，所以才有
Configure 与 key 文件）。

## 测试

```bash
npm test     # 109 个测试，node:test，全离线（90 核心 + 19 插件）
```

覆盖 agent 循环、凭据刷新/轮换、会话持久化、检查点还原、plan 护栏规则表、
循环与错误护栏，以及对本地 mock server 的端到端运行。

联网冒烟测试（需要已登录账号，**不在** `npm test` 里）：

```bash
node test/live-free.mjs
```

## 目录

```
src/
  cli.js              参数解析、命令分发、渲染
  index.js            公共入口（createAgent、请求头工具）
  agent.js            agent 循环：流 → 工具调用 → 结果
  llm.js              兼容 OpenAI 网关的 SSE 客户端
  tools.js            注册表 + 别名解析
  tool-read.js        read_files
  tool-editor.js      editor
  tool-run.js         run_commands
  tool-search.js      search_codebase
  plan-guard.js       plan 模式静态 shell 规则表
  guardrails.js       循环 + 错误护栏
  checkpoint.js       git ref 快照
  session.js          JSONL 会话、dataDir
  credentials.js      token 缓存，600 权限原子写
  cline-auth-api.js   /auth/refresh 交换
  auth.js             WorkOS 设备流
  login.js            配对交互
  prompt*.js          系统提示词（act / plan / yolo）
dsh/                  DeepSeek Harness 插件（见 dsh/README.md）
```

## 关于加密

Bun 单文件格式把模块表追加在 `---- Bun! ----` 尾标之后。Cline ≥ 3.0.x 把这张表
存成**加密资产块**而不是明文 JS，所以 `strings`、尾标切取、已知模块图重建都
不成立。任何声称能"解包"这个二进制的方案，要么在调试器里跑它，要么在读开源树——
不存在静态路径。本项目走的是开源 + 协议这条路。

## 法律

仅供研究与互操作。用你自己的账号时，遵守 Cline 的服务条款是你自己的责任。本仓库
不包含任何凭据、token 或账号数据。`src/auth.js` 里的 `WORKOS_CLIENT_ID` 是
Cline 的**公开** OAuth client id，按设计本来就嵌在浏览器可见的客户端里。

## 许可

MIT，见 [LICENSE](LICENSE)。Cline、WorkOS 与各模型名称归其各自所有者；本仓库
不含 Cline 的代码、二进制或厂商产物，与 Cline 官方无隶属或背书关系。
