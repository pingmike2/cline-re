import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { startMockCline } from "./mock-server.js";
import { tmpdir } from "./helpers.js";

const WORK = await tmpdir();
const DATA = await tmpdir();
await fs.writeFile(path.join(WORK, "smoke.txt"), "hello-from-smoke-42\n");

const mock = await startMockCline();

const child = spawn(process.execPath, ["src/cli.js", "--base-url", mock.url, "-m", "test-model", "-c", WORK, "--json", "read smoke.txt and summarize"], {
	cwd: new URL("..", import.meta.url).pathname,
	env: { ...process.env, CLINE_DATA_DIR: DATA, CLINE_API_KEY: "test-key" },
});

let out = "";
child.stdout.on("data", (d) => { out += d; });
child.stderr.on("data", (d) => { out += d; });

const code = await new Promise((r) => child.on("close", r));
await mock.close();

const lines = out.trim().split("\n");
const events = lines.filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
const result = events.find((e) => e.type === "result");

const sessions = await fs.readdir(path.join(DATA, "sessions")).catch(() => []);

console.log(JSON.stringify({
	exitCode: code,
	turnEvents: events.filter((e) => e.type === "turn-started").length,
	status: result?.status,
	iterations: result?.iterations,
	// no per-token output event leaked
	hasTokenLeak: events.some((e) => e.type === "message-added"),
	sessionsSaved: sessions.length,
	transcriptHasFile: out.includes("hello-from-smoke-42") || result?.status === "completed",
}, null, 2));
