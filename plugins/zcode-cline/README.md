# zcode-cline — cline-re as a ZCode plugin

Wraps the `cline-re` CLI as a ZCode plugin with three interchangeable entry
points. Unlike `dsh/` (which runs in-process inside DeepSeek Harness), the ZCode
plugin cannot register a model provider — ZCode's session model is configured by
the client — so this package only exposes the **delegation** half: a session
model can hand a self-contained task to the cline-re agent, which brings its own
`read_files` / `editor` / `run_commands` / `search_codebase` tools, plan/yolo
modes, and loop and mistake guardrails.

| Component | Kind | What it does |
| --- | --- | --- |
| `/cline <task>` | slash command | Instructs the session model to launch the CLI and relay the answer. Supports inline `-m`, `-p`, `-y`, `-c` directives. |
| `cline` | skill | Same flow, auto-triggered when the user asks to run something "with cline". |
| `cline` | subagent | The main session can delegate to a dedicated agent whose only job is launching the CLI and reporting the result. |

## Layout

```
plugins/zcode-cline/
  .zcode-plugin/plugin.json   manifest (commands + skills + agents)
  commands/cline.md           /cline slash command
  skills/cline/SKILL.md       auto-trigger skill
  agents/cline.md             subagent definition
plugins/marketplace.json      local dev marketplace (dev-cline-re)

src/cli.js                    the CLI all three entry points launch (repo root,
                              not inside the plugin directory)
```

The plugin is pure markdown + JSON: no code runs inside ZCode itself; the only
process it ever launches is `node src/cli.js` of this repository.

## CLI resolution and credentials

- CLI entry: `ZCODE_CLINE_CLI` env var, defaulting to `F:\cline-re\src\cli.js`
  (this checkout). Override it if the repo moves.
- API key, in order: `CLINE_API_KEY` env var, then credentials stored by
  `cline-re login` (`~/.cline-re/credentials.json`). A credential failure
  (exit code 2) is surfaced to the user, never retried.
- Models: `nemotron` (default), `solar-mini4`, `lightning`, `beam`; see
  `cline-re models`.

## Install (local dev marketplace)

1. ZCode → **Plugin Marketplace → Add → Add Plugin Marketplace**, paste
   `F:\cline-re\plugins` (the directory containing `marketplace.json`).
2. The market appears as **dev-cline-re**; install the **zcode-cline** plugin
   from it.
3. Try it with: `/cline read package.json and summarize the test scripts`
   — expected result: a cline agent run on `nemotron` whose summary is relayed
   back, with the iteration count reported.
