# Contributing / 参与贡献

[English](#english) · [简体中文](#简体中文)

---

## English

Thanks for helping. This repository is a **clean-room reimplementation**: no Cline
source code, binary, or vendor bundle is vendored here, and nothing is patched or
decrypted. Every protocol constant (headers, endpoints, aliases, rule tables) was
derived from observable behaviour — HTTP traffic, TypeScript declaration files,
and the open-source app shell — and then re-expressed as dependency-free ESM.

Please keep that property intact:

- Do **not** paste decompiled or extracted code, nor copy code from a proprietary
  bundle, into a pull request. Describe the behaviour and implement it yourself.
- Do **not** commit credentials, tokens, cookies, session dumps, or captured
  traffic that contains them. Keys belong in `~/.cline-re/credentials.json`,
  `~/.dsh/cline.json`, or an environment variable — never in the tree.
- Do **not** add runtime dependencies unless there is no reasonable way to avoid
  it. The project intentionally ships with zero.
- Do **not** weaken the guards (plan-mode rule tables, loop/mistake limits) to
  make a test pass.

### Development

```bash
git clone https://github.com/pingmike2/cline-re.git
cd cline-re
npm install          # links the `cline` / `cline-re` bins; no runtime deps
npm test             # 109 offline tests (node:test)
node test/live-free.mjs   # optional, needs a signed-in account
```

Requires Node 20+ (ESM, `node:test`, `AbortSignal.timeout`). npm scripts are
plain `node` invocations, so a broken npm shim never blocks you:

```bash
node --test "test/*.test.js" "dsh/test/*.test.js"
```

Live tests hit the real gateway and consume free-model quota; keep them out of
`npm test` and never make CI depend on them.

### Style

- Tabs, double quotes, semicolons; ESM only; no build step.
- Prefer small pure helpers in their own module over growing `cli.js`.
- No comments that restate the code; a short comment is welcome when it records a
  protocol fact or a non-obvious constraint.
- Every new protocol constant should be traceable: say where it came from in the
  commit message or in `NOTES.md`.

### Pull requests

1. Keep the diff focused; one behaviour per PR.
2. Add or update an offline test. Tests must not touch the network.
3. Run the full suite before opening the PR; paste the summary line.
4. For behaviour derived from observation, include the request/response shape
   (redacted) in the PR description so reviewers can re-verify it.
5. Commit messages: `type(scope): summary` (`fix(cli): …`, `feat(plugin): …`),
   body explaining *why*.

### DSH plugin (`dsh/`)

The plugin has two switchable halves — a model provider and a `cline` tool — plus
a browser half for the Configure form in DSH's plugin page.

- Host entry: `dsh/lib/index.js` (exports `name`, `inject`, `Config`, `apply`).
- Wire translation: `dsh/lib/wire.js`; SSE → DSH chunks: `dsh/lib/provider.js`.
- Browser half: `dsh/lib/client.js` — must stay a
  `window.__ModuleLoader__.load({ id, factory })` module (no top-level ESM,
  no side effects outside the factory).
- Key lookup order is part of the contract (Configure value → `cline.json` →
  `CLINE_API_KEY` → `cline-re login`). Changing it requires a test in
  `dsh/test/settings.test.js`.
- `dsh/README.md` documents the audit surface; keep it in sync with the code.

### Reporting

Open an issue with: version (`git rev-parse --short HEAD`), Node version, the
command, expected vs actual, and any error text with tokens removed. For security
issues, do not open a public issue — email the maintainer listed in
`package.json` and give us time to fix it.

---

## 简体中文

感谢参与。这个仓库是**净室重实现**：不包含 Cline 的源码、二进制或厂商产物，
也不做任何补丁或解密。所有协议常量（请求头、端点、别名、规则表）都来自可观测
行为——HTTP 流量、TypeScript 声明文件、开源 app shell——再用零依赖 ESM 重写。

请保持这一点：

- **不要**把反编译/提取出来的代码，或专有包里的代码片段贴进 PR。描述行为，
  然后自己实现。
- **不要**提交凭据、token、cookie、会话转储，或含这些内容的抓包。key 只放在
  `~/.cline-re/credentials.json`、`~/.dsh/cline.json` 或环境变量里，绝不进仓库。
- **不要**引入运行时依赖，除非确实无法避免；本项目刻意保持零依赖。
- **不要**为了让测试变绿而放宽护栏（plan 模式规则表、循环/错误上限）。

### 开发

```bash
git clone https://github.com/pingmike2/cline-re.git
cd cline-re
npm install          # 只链接 cline / cline-re 命令，无运行时依赖
npm test             # 109 个离线测试（node:test）
node test/live-free.mjs   # 可选，需要已登录的账号
```

需要 Node 20+（ESM、`node:test`、`AbortSignal.timeout`）。npm 脚本就是普通的
`node` 调用，所以即使 npm 的 shim 坏了也能直接跑：

```bash
node --test "test/*.test.js" "dsh/test/*.test.js"
```

联网测试会真的打网关、消耗免费额度；它们不在 `npm test` 里，CI 也不应依赖它们。

### 风格

- 制表符、双引号、分号；只用 ESM；没有构建步骤。
- 新逻辑尽量写成独立的小纯函数，而不是继续撑大 `cli.js`。
- 不写复述代码的注释；记录协议事实或非显然约束的短注释是受欢迎的。
- 每个新协议常量都要可追溯：在提交信息或 `NOTES.md` 里写清它从哪来。

### Pull Request

1. 一个 PR 只做一件事，保持 diff 聚焦。
2. 补或改一个离线测试；测试不得访问网络。
3. 开 PR 前跑完整套件，并在描述里贴上汇总行。
4. 由观测得出的行为，请在描述里给出请求/响应形状（脱敏），方便审核复现。
5. 提交信息：`type(scope): 摘要`（`fix(cli): …`、`feat(plugin): …`），正文写
   *为什么*。

### DSH 插件（`dsh/`）

插件有两半可独立开关——模型供应商、`cline` 工具——外加一个浏览器半边，负责
DSH 插件页里的 Configure 表单。

- 宿主入口：`dsh/lib/index.js`（导出 `name`、`inject`、`Config`、`apply`）。
- 消息转换：`dsh/lib/wire.js`；SSE → DSH chunk：`dsh/lib/provider.js`。
- 浏览器半边：`dsh/lib/client.js`，必须是
  `window.__ModuleLoader__.load({ id, factory })` 模块（不能有顶层 ESM 语句，
  副作用只能出现在 factory 内）。
- key 查找顺序属于契约的一部分（Configure 表单 → `cline.json` →
  `CLINE_API_KEY` → `cline-re login`）。要改顺序，必须在
  `dsh/test/settings.test.js` 里加测试。
- `dsh/README.md` 是审核用的说明，改代码时请同步更新。

### 反馈

开 issue 请附：版本（`git rev-parse --short HEAD`）、Node 版本、执行的命令、
预期与实际，以及去掉 token 的错误文本。安全问题请不要公开开 issue，直接邮件
联系 `package.json` 里的维护者。