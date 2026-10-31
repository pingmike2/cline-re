#!/usr/bin/env node
import process from "node:process";
import { createAgent, CLINE_API_BASE, clineGatewayHeaders } from "./index.js";
import { loadSession, listSessions } from "./session.js";
import { loginAndReport, credentialsPath } from "./login.js";
import { CredentialStore } from "./credentials.js";
import { resolveModelAlias, DEFAULT_MODEL } from "./models.js";

function parseArgs(argv) {
	const opts = { mode: "act", model: DEFAULT_MODEL, baseURL: CLINE_API_BASE, json: false, cwd: process.cwd() };
	const rest = [];
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i];
		const next = () => argv[++i];
		switch (a) {
			case "login": opts.command = "login"; break;
			case "logout": opts.command = "logout"; break;
			case "whoami": opts.command = "whoami"; break;
			case "models": opts.command = "models"; break;
			case "-p": case "--plan": opts.mode = "plan"; break;
			case "-y": case "--yolo": opts.mode = "yolo"; break;
			case "--json": opts.json = true; break;
			case "-m": case "--model": opts.model = next(); break;
			case "-c": case "--cwd": opts.cwd = next(); break;
			case "-k": case "--key": opts.apiKey = next(); break;
			case "--retries": opts.maxConsecutiveMistakes = Number(next()); break;
			case "--max-iterations": opts.maxIterations = Number(next()); break;
			case "--session": opts.sessionId = next(); break;
			case "--checkpoints": opts.checkpoints = true; break;
			case "--base-url": opts.baseURL = next(); break;
			case "-r": case "--resume": opts.resume = next(); break;
			case "--sessions": opts.listSessions = true; break;
			case "-h": case "--help": opts.help = true; break;
			case "-V": case "--version": opts.version = true; break;
			default:
				if (a.startsWith("-")) throw new Error(`Unknown option: ${a}`);
				rest.push(a);
		}
	}
	opts.prompt = rest.join(" ").trim();
	return opts;
}

const HELP = `Usage: cline [options] [prompt]
       cline <login|logout|whoami|models>

Cline CLI reimplementation

Commands:
  login                      Sign in with your Cline account (browser pairing)
  logout                     Remove stored credentials
  whoami                     Show the signed-in account
  models                     List models (free / cloud / pass)

Options:
  -p, --plan                 Run in plan mode (read-only)
  -y, --yolo                 Background/headless mode
  --json                     Emit events as JSON lines
  -c, --cwd <path>           Working directory
  -m, --model <id>           Model id (or alias: solar-mini4|nemotron|lightning|beam)
  -k, --key <api-key>        API key (or CLINE_API_KEY)
  --base-url <url>           OpenAI-compatible base URL
  --retries <n>              Max consecutive mistakes (default 6)
  --max-iterations <n>       Hard cap on loop iterations
  --session <id>             Explicit session id
  -r, --resume <id>          Resume a saved session
  --checkpoints              Enable git checkpoint snapshots
  --sessions                 List saved sessions
  -V, --version              Print version
  -h, --help                 Show this help`;

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) { console.log(HELP); return 0; }
	if (opts.version) { console.log("cline-re 0.1.0"); return 0; }

	if (opts.command === "login") {
		const { userInfo } = await loginAndReport();
		console.log(JSON.stringify({ ok: true, email: userInfo?.email ?? null }));
		return 0;
	}
	if (opts.command === "logout") {
		const { removeCredentials } = await import("./auth.js");
		await removeCredentials();
		console.log(`Removed ${credentialsPath()}`);
		return 0;
	}
	if (opts.command === "whoami") {
		const store = new CredentialStore();
		const creds = await store.load();
		if (!creds?.userInfo) { console.error("not logged in: run `cline-re login`"); return 1; }
		console.log(JSON.stringify({ email: creds.userInfo.email, userId: creds.userInfo.clineUserId ?? creds.userInfo.subject, expiresAt: creds.expiresAt }));
		return 0;
	}
	if (opts.command === "models") {
		const res = await fetch(`${CLINE_API_BASE}/ai/cline/recommended-models`, { headers: clineGatewayHeaders() });
		const body = await res.json();
		for (const group of ["free", "clineCloud", "clinePass", "recommended"]) {
			if (!Array.isArray(body[group])) continue;
			console.log(`\n[${group}]`);
			for (const m of body[group]) console.log(`  ${m.id}`);
		}
		return 0;
	}

	if (opts.listSessions) {
		for (const s of await listSessions()) console.log(`${s.id}	${s.updatedAt}	${s.messages} msg	${s.title}`);
		return 0;
	}
	if (!opts.prompt) { console.error("error: missing prompt\n\n" + HELP); return 2; }

	const model = resolveModelAlias(opts.model);
	let apiKey = opts.apiKey ?? process.env.CLINE_API_KEY;
	if (!apiKey && opts.baseURL === CLINE_API_BASE) {
		try {
			apiKey = await new CredentialStore().getAccessToken();
		} catch (err) {
			console.error(`error: ${err.message}`);
			console.error("run `cline-re login` to sign in, or pass --key / CLINE_API_KEY");
			return 2;
		}
	}

	const onEvent = opts.json
		? (e) => console.log(JSON.stringify({ type: e.type, iteration: e.iteration, status: e.status }))
		: (e) => {
			if (e.type === "turn-started") console.error(`\n[iteration ${e.iteration}]`);
			if (e.type === "message-added" && e.message.role === "assistant" && e.message.content) {
				console.error(e.message.content);
			}
		};

	let history = [];
	if (opts.resume) history = (await loadSession(opts.resume)).messages ?? [];
	const { run: agentRun } = await createAgent({
		...opts,
		model,
		apiKey,
		onEvent,
		headers: opts.baseURL === CLINE_API_BASE ? clineGatewayHeaders() : undefined,
	});
	const result = await agentRun({ messages: [...history, { role: "user", content: opts.prompt }] });

	if (opts.json) console.log(JSON.stringify({ type: "result", status: result.status, iterations: result.iterations, usage: result.usage, output: result.outputText }));
	else {
		console.log(`\n--- ${result.status} after ${result.iterations} iteration(s) ---`);
		console.log(result.outputText || "(no output)");
		if (result.error) console.error(`error: ${result.error}`);
	}
	return result.status === "completed" ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((err) => {
	console.error(`fatal: ${err.message}`);
	process.exit(1);
});
