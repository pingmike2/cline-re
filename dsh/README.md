# dsh-cline — cline-re as a DeepSeek Harness plugin

[English](#english) · [简体中文](#简体中文)

---

## English

This sub-package wraps `cline-re` as a DSH plugin. Only `lib/provider.js` and
`lib/tool.js` touch the network or spawn processes; everything else is a
translation layer, which is what makes the plugin auditable.

| File | Role | Lines |
| --- | --- | --- |
| `lib/index.js` | plugin entry: exports `Config`, registers provider + tool | ~85 |
| `lib/settings.js` | config normalisation + API key lookup order | ~70 |
| `lib/provider.js` | `cline` model provider (DSH chunk protocol ← OpenAI SSE) | ~180 |
| `lib/wire.js` | DSH message/block → OpenAI messages/tools | ~90 |
| `lib/tool.js` | `cline` tool: delegate a task to the cline-re agent | ~70 |
| `lib/client.js` | browser half: the Configure form under Plugins | ~170 |
| `cordis.patch.yml` | mount row / default config | 15 |

### Two independently switchable halves

1. **Model provider** — `cline` shows up in DSH's provider/model lists, so DSH's
   own agent loop can run Cline's free models (default
   `cline-free/nemotron-3.5-super-vl`, alias `nemotron`; also `solar-mini4`,
   `lightning`, `laguna`, `beam`).
2. **Delegation tool** — a model can call `cline` to hand a self-contained task
   to the cline-re agent, which brings its own read_files / editor / run_commands
   / search_codebase tools, plan/yolo modes, loop and mistake guardrails.

`enableProvider` / `enableTool` switch each half off.

### Where the API key goes

**Recommended: DSH → Settings → Plugins → `dsh-cline` → Configure**, then paste
the key into “Cline API Key”. The form writes this row's `apiKey` (persisted by
the DSH settings layer; the field is write-only, so the browser never receives
the secret back) and takes effect without a restart.

Any of these also work, in this order:

1. plugin row `config.apiKey` (the Configure form);
2. `<DSH_HOME>/cline.json` — `{"apiKey": "..."}`, re-read on every call, no
   restart needed;
3. environment variable `CLINE_API_KEY`;
4. `cline-re login` credentials in `~/.cline-re/credentials.json` (WorkOS device
   flow, refreshed automatically).

With none of them, the provider/tool reports `MISSING_CREDENTIAL` and names the
file to create.

```powershell
'{"apiKey":"your Cline API key"}' | Set-Content -Encoding utf8 "$env:DSH_HOME\cline.json"
```

Keys are never logged or echoed in errors; nothing under `lib/` prints them.

### Install (local link, same pattern as dsh-telegram-control)

1. add the dependency to the profile's `package.json`:

   ```json
   "dsh-cline": "link:F:/cline-re/dsh"
   ```

2. append `dsh-cline` to `dsh.profile.bundles`;
3. install the link in the profile directory (`%DSH_HOME%\profiles\desktop`):

   ```powershell
   node "C:\Users\admin\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs" install
   ```

   (`dsh/install.ps1` does 1–2 and creates the junction; `-Remove` rolls back.)
4. restart DSH (`%DSH_HOME%\restart-dsh.ps1`).

After the restart the Plugins page shows `dsh-cline`; clicking it opens Configure.

### Usage

- **As a model**: pick provider `cline`, then e.g.
  `cline-free/nemotron-3.5-super-vl` (the default).
- **As a tool**: call `cline` with
  `{prompt, cwd?, mode?: "act"|"plan"|"yolo", model?, maxIterations?}`.

### Known limitations (read these during audit)

- **DSH's Models settings page only renders key inputs for the built-in
  `llm-deepseek` / `llm-pi-ai` namespaces**; a custom provider lands in the
  “unknown” layout. The key entry point is therefore the Plugins → Configure form
  (or `cline.json`), not that page.
- The Configure form stores the key in this row's config through the DSH settings
  layer; the input is write-only and never echoed. If you do not want it in the
  profile config, use `cline.json` instead.
- Model metadata (contextWindow 200k / maxTokens 32k) is a conservative
  placeholder; the Cline gateway exposes no equivalent field.
- The route is declared text-only (`input: ["text"]`), so DSH replaces images
  with placeholder text.
- Static API keys are sent as `Authorization: Bearer <key>`; `cline-re login`
  WorkOS tokens already carry the `workos:` prefix. Both share one
  `OpenAIClient`, matching CLI behaviour.
- The browser half needs `dsh-client-ui-plugin-manager` to provide the
  `plugins.row.config` slot; on older DSH builds the form degrades to a hint
  pointing at `cline.json`.

### Tests

```powershell
cd F:\cline-re\dsh
node --test "test/*.test.js"   # 19 offline tests (provider/tool/plugin/client/settings)
cd F:\cline-re
node --test "test/*.test.js" "dsh/test/*.test.js"   # 109 (90 core + 19 plugin)
```

---

## 简体中文

这个子包是 `cline-re` 的 DSH 封装。真正碰网络/起进程的只有 `lib/provider.js` 与
`lib/tool.js`，其余都是转换层：

| 文件 | 作用 | 行数 |
| --- | --- | --- |
| `lib/index.js` | 插件入口：导出 `Config`、注册 provider 与工具 | ~85 |
| `lib/settings.js` | 配置归一化 + API key 查找顺序 | ~70 |
| `lib/provider.js` | `cline` 模型供应商（DSH chunk 协议 ← OpenAI SSE） | ~180 |
| `lib/wire.js` | DSH message/block → OpenAI messages/tools | ~90 |
| `lib/tool.js` | `cline` 工具：把任务委派给 cline-re agent | ~70 |
| `lib/client.js` | 浏览器半边：Plugins 里的 Configure 表单（填 key） | ~170 |
| `cordis.patch.yml` | 挂载行（默认配置） | 15 |

### 两种用法（可独立开关）

1. **模型供应商**：`cline` 出现在 DSH 的供应商/模型列表里，DSH 自己的 agent 循环
   直接走 Cline 免费模型（默认 `cline-free/nemotron-3.5-super-vl`，别名
   `nemotron`；还有 `solar-mini4`、`lightning`、`laguna`、`beam`）。
2. **委派工具**：模型可以调用 `cline` 工具，把一段自包含任务交给 cline-re 自己的
   agent（它有自己的 read_files / editor / run_commands / search_codebase、
   plan/yolo 模式、循环与错误护栏）。

`enableProvider` / `enableTool` 可以单独关掉任一半。

### API key 填在哪里

**推荐：DSH → 设置 → 插件 → `dsh-cline` 这一行 → Configure**，把 key 填进
“Cline API Key” 保存。表单写的是本行的 `apiKey` 字段（由 DSH 设置层落盘；
`secret` 字段只单向写入，读回时会被打码，浏览器永远拿不到明文），保存后立即
生效、不用重启。

也可以在下面任一位置填，按优先级查找、找到即用：

1. 插件行 `config.apiKey`（即上面的 Configure 表单）；
2. `<DSH_HOME>/cline.json` —— `{"apiKey": "..."}`，每次调用时重新读取，改完不用
   重启；
3. 环境变量 `CLINE_API_KEY`；
4. `cline-re login` 写入的 `~/.cline-re/credentials.json`（WorkOS 设备流，会自动
   刷新）。

四者都没有时，工具/供应商会报 `MISSING_CREDENTIAL`，并直接告诉你该写哪个文件。

```powershell
'{"apiKey":"你的 Cline API key"}' | Set-Content -Encoding utf8 "$env:DSH_HOME\cline.json"
```

密钥不会被写进日志或错误信息；`lib/` 里没有任何地方回显它（Configure 表单也只
显示“已保存”，不回填明文）。

### 安装（本地 link，和 dsh-telegram-control 同一套路）

1. 在 profile 的 `package.json` 里加依赖：

   ```json
   "dsh-cline": "link:F:/cline-re/dsh"
   ```

2. 把 `dsh-cline` 加进 `dsh.profile.bundles` 数组（放在 `dsh-free-search` 之类的
   第三方插件旁边）。
3. 在 profile 目录（`%DSH_HOME%\profiles\desktop`）里装链接：

   ```powershell
   node "C:\Users\admin\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs" install
   ```

   （`dsh/install.ps1` 会做 1、2 并建目录 junction，`-Remove` 可回滚。）
4. 重启 DSH（`%DSH_HOME%\restart-dsh.ps1`，或退出后重新打开）。

重启后在 Plugins 页能看到 `dsh-cline` 行，点进去就是 Configure 表单。

### 使用

- **当模型用**：在模型选择里选供应商 `cline`，再选
  `cline-free/nemotron-3.5-super-vl` 等（默认就是它）。
- **当工具用**：让模型调用 `cline`，参数
  `{prompt, cwd?, mode?: "act"|"plan"|"yolo", model?, maxIterations?}`。

### 已知限制（审核时请重点看）

- **DSH 的 Models 设置页只给 `llm-deepseek` / `llm-pi-ai` 两个内置命名空间渲染
  key 输入框**；自定义供应商会落到 “unknown” 布局。本插件的 key 入口是 Plugins
  里的 Configure 表单（或 `cline.json`），不是那个页面。
- Configure 表单把 key 存进本行配置，由 DSH 设置层落盘；表单是只写输入（不回显）。
  不想让它进 profile 配置就用 `cline.json`。
- 模型元数据（contextWindow 200k / maxTokens 32k）是保守占位值，Cline 网关没有
  公开的等价字段。
- 路由声明为纯文本（`input: ["text"]`），图片会被 DSH 替换成占位文本。
- 静态 API key 走 `Authorization: Bearer <key>`；`cline-re login` 的 WorkOS
  token 自带 `workos:` 前缀，两者共用同一条 `OpenAIClient`，与 CLI 行为一致。
- 浏览器半边需要 `dsh-client-ui-plugin-manager` 提供 `plugins.row.config`
  槽位；老版本 DSH 没有这个槽时，表单会退化成提示你用 `cline.json`。

### 测试

```powershell
cd F:\cline-re\dsh
node --test "test/*.test.js"   # 19 个离线测试（provider/tool/plugin/client/settings）
cd F:\cline-re
node --test "test/*.test.js" "dsh/test/*.test.js"   # 109 个（仓库原有 90 + 插件 19）
```
