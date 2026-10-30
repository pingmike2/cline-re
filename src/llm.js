import { classifyClineError } from "./cline-auth-api.js";

export class ProviderError extends Error {
	constructor(message, { status, retryable } = {}) {
		super(message);
		this.name = "ProviderError";
		this.status = status;
		this.retryable = retryable ?? (status === 429 || (status >= 500 && status < 600));
	}
}

export class ContextWindowError extends Error {
	constructor(message) {
		super(message);
		this.name = "ContextWindowError";
	}
}

const CONTEXT_ERROR_PATTERNS = [
	/context[_ ]length[ _]exceeded/i,
	/context[_ ]window/i,
	/maximum context/i,
	/too many tokens/i,
	/prompt is too long/i,
];

export function isContextWindowError(err) {
	const status = err?.status;
	if (status === 413) return true;
	const msg = err instanceof Error ? err.message : String(err?.message ?? err ?? "");
	return CONTEXT_ERROR_PATTERNS.some((re) => re.test(msg));
}

export class OpenAIClient {
	constructor({ baseURL, apiKey, model, headers = {}, fetchImpl, maxRetries = 3 } = {}) {
		this.baseURL = String(baseURL ?? "").replace(/\/+$/, "");
		this.apiKey = apiKey;
		this.model = model;
		this.headers = headers;
		this.fetchImpl = fetchImpl ?? fetch;
		this.maxRetries = maxRetries;
	}

	authHeaders() {
		const h = { "Content-Type": "application/json", ...this.headers };
		if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
		return h;
	}

	async chat({ messages, tools, temperature, signal, timeoutMs = 300000, maxTokens, onText, onReasoning }) {
		const body = { model: this.model, messages, stream: true };
		if (maxTokens != null) body.max_tokens = maxTokens;
		if (tools?.length) {
			body.tools = tools.map((t) => ({
				type: "function",
				function: { name: t.name, description: t.description, parameters: t.inputSchema },
			}));
			body.tool_choice = "auto";
		}
		if (temperature != null) body.temperature = temperature;

		let attempt = 0;
		for (;;) {
			try {
				return await this.streamOnce(body, { signal, timeoutMs, onText, onReasoning });
			} catch (err) {
				const retryable = err instanceof ProviderError && err.retryable;
				if (!retryable || attempt >= this.maxRetries) throw err;
				attempt += 1;
				await sleep(Math.min(30000, 500 * 2 ** attempt));
			}
		}
	}

	async streamOnce(body, { signal, timeoutMs, onText, onReasoning }) {
		const timeout = AbortSignal.timeout(timeoutMs);
		const composite = signal ? AbortSignal.any([timeout, signal]) : timeout;
		let res;
		try {
			res = await this.fetchImpl(`${this.baseURL}/chat/completions`, {
				method: "POST",
				headers: this.authHeaders(),
				body: JSON.stringify(body),
				signal: composite,
			});
		} catch (err) {
			throw new ProviderError(`Request failed: ${err.message}`, { retryable: true });
		}

		if (!res.ok) {
			const text = await res.text().catch(() => "");
			const message = `HTTP ${res.status}: ${text.slice(0, 2000) || res.statusText}`;
			if (isContextWindowError({ message, status: res.status })) throw new ContextWindowError(message);
			const clineErr = classifyClineError(res.status, text);
			if (clineErr) throw clineErr;
			throw new ProviderError(message, { status: res.status });
		}
		return this.collect(await res.body, composite, { onText, onReasoning });
	}

	async collect(body, signal, hooks = {}) {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let text = "";
		let reasoning = "";
		let finishReason;
		const usage = { inputTokens: 0, outputTokens: 0 };
		const toolCalls = new Map();

		try {
			for (;;) {
				if (signal?.aborted) throw new ProviderError("Request aborted", { retryable: false });
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const parts = buffer.split("\n\n");
				buffer = parts.pop() ?? "";
				for (const part of parts) {
					const line = part.split("\n").find((l) => l.startsWith("data:"));
					if (!line) continue;
					const payload = line.slice(5).trim();
					if (!payload || payload === "[DONE]") continue;
					let json;
					try { json = JSON.parse(payload); } catch { continue; }
					consumeChunk(json, { toolCalls, usage, onText: (t) => { text += t; hooks.onText?.(t); }, onReasoning: (t) => { reasoning += t; hooks.onReasoning?.(t); }, setFinish: (f) => { finishReason = f; } });
				}
			}
		} finally {
			reader.releaseLock?.();
		}

		return {
			text,
			reasoning: reasoning || undefined,
			finishReason: finishReason ?? "stop",
			usage,
			toolCalls: [...toolCalls.values()].sort((a, b) => a.index - b.index).map((c) => ({ toolCallId: c.id, toolName: c.name, input: safeParse(c.arguments) })),
		};
	}
}

function consumeChunk(json, ctx) {
	const choice = json.choices?.[0];
	if (json.usage) {
		ctx.usage.inputTokens = json.usage.prompt_tokens ?? ctx.usage.inputTokens;
		ctx.usage.outputTokens = json.usage.completion_tokens ?? ctx.usage.outputTokens;
	}
	if (!choice) return;
	if (choice.finish_reason) ctx.setFinish(choice.finish_reason);
	const delta = choice.delta ?? {};
	if (typeof delta.content === "string" && delta.content) ctx.onText(delta.content);
	if (typeof delta.reasoning_content === "string" && delta.reasoning_content) ctx.onReasoning(delta.reasoning_content);
	if (Array.isArray(delta.tool_calls)) {
		for (const tc of delta.tool_calls) {
			const idx = tc.index ?? 0;
			const cur = ctx.toolCalls.get(idx) ?? { index: idx, id: undefined, name: undefined, arguments: "" };
			if (tc.id) cur.id = tc.id;
			if (tc.function?.name) cur.name = (cur.name ?? "") + tc.function.name;
			if (tc.function?.arguments) cur.arguments += tc.function.arguments;
			ctx.toolCalls.set(idx, cur);
		}
	}
}

function safeParse(text) {
	if (!text) return {};
	try { return JSON.parse(text); } catch { return {}; }
}

export function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}
