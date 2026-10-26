import path from "node:path";
import { OpenAIClient } from "./llm.js";
import { buildSystemPrompt } from "./prompt.js";
import { createTools } from "./registry.js";
import { AgentRuntime } from "./agent.js";
import { GitCheckpointer } from "./checkpoint.js";
import { newSessionId, saveSession, loadSession } from "./session.js";

export const CLINE_API_BASE = "https://api.cline.bot/api/v1";

export function clineHeaders(version = "3.0.74", platform = process.platform) {
	return {
		"X-CLIENT-TYPE": "cline",
		"X-CLIENT-VERSION": version,
		"X-CORE-VERSION": "0.2.0",
		"X-PLATFORM": platform,
		"X-PLATFORM-VERSION": version,
		"X-IS-MULTIROOT": "false",
		"User-Agent": `Cline/${version}`,
		"HTTP-Referer": "https://cline.bot",
		"X-Title": "Cline",
	};
}

export function clineGatewayHeaders() {
	return clineHeaders();
}

export async function createAgent({
	apiKey,
	baseURL = CLINE_API_BASE,
	model = "anthropic/claude-sonnet-5.5",
	cwd = process.cwd(),
	mode = "act",
	maxIterations,
	maxConsecutiveMistakes = 6,
	headers,
	fetchImpl,
	onEvent,
	logger,
	systemPrompt,
	caps,
	sessionId,
	checkpoints = false,
} = {}) {
	const client = new OpenAIClient({
		baseURL,
		apiKey,
		model,
		headers: headers ?? (baseURL === CLINE_API_BASE ? clineHeaders() : {}),
		fetchImpl,
	});
	const session = sessionId ?? newSessionId();
	let checkpointer;
	if (checkpoints) {
		checkpointer = new GitCheckpointer({ cwd: path.resolve(cwd), sessionId: session, logger: typeof logger === "function" ? logger : () => {} });
		await checkpointer.init();
	}
	const tools = createTools({ caps });
	const prompt = systemPrompt ?? buildSystemPrompt({ mode, cwd, ide: "cline-cli" });
	const runtime = new AgentRuntime({
		client,
		tools,
		systemPrompt: prompt,
		maxIterations,
		maxConsecutiveMistakes,
		cwd: path.resolve(cwd),
		mode,
		onEvent,
		logger,
		checkpointer,
	});
	const checkpointsSeen = [];
	const forwardEvent = (e) => {
		if (e?.type === "checkpoint") checkpointsSeen.push({ ref: e.ref, runCount: e.runCount });
		onEvent?.(e);
	};
	runtime.onEvent = forwardEvent;

	async function run(input) {
		const result = await runtime.run(input);
		await saveSession({
			id: session,
			title: Array.isArray(input?.messages) ? String(input.messages.find((m) => m.role === "user")?.content ?? "").slice(0, 80) : "",
			mode,
			messages: result.messages,
			status: result.status,
		}).catch(() => {});
		return { ...result, sessionId: session, checkpoints: checkpointsSeen.slice() };
	}

	return { runtime, client, tools, run, sessionId: session, loadSession };
}
