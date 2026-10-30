import { OpenAIClient, ProviderError, ContextWindowError } from "../../src/llm.js";
import { CLINE_MODEL_CATALOG, resolveModelAlias } from "../../src/models.js";
import { finishKind, toClientTools, toWireMessages } from "./wire.js";

const DEFAULT_CONTEXT_WINDOW = 200000;
const DEFAULT_MAX_TOKENS = 32768;

function createQueue() {
	const items = [];
	let waiting;
	let closed = false;
	return {
		push(item) {
			if (closed) return;
			if (waiting) {
				const resolve = waiting;
				waiting = undefined;
				resolve({ value: item, done: false });
				return;
			}
			items.push(item);
		},
		close() {
			closed = true;
			if (waiting) {
				const resolve = waiting;
				waiting = undefined;
				resolve({ value: undefined, done: true });
			}
		},
		[Symbol.asyncIterator]() {
			return {
				next() {
					if (items.length > 0) return Promise.resolve({ value: items.shift(), done: false });
					if (closed) return Promise.resolve({ value: undefined, done: true });
					return new Promise((resolve) => { waiting = resolve; });
				},
			};
		},
	};
}

export function describeFailure(err) {
	if (err instanceof ContextWindowError) return { code: "CONTEXT_WINDOW_EXCEEDED", message: err.message };
	if (err?.name === "FreeLimitError" || /free limit reached/i.test(String(err?.message ?? ""))) {
		return { code: "QUOTA", message: err.message };
	}
	if (err?.name === "AbortError" || err?.message === "Request aborted") return { code: "ABORTED", message: "Request aborted", aborted: true };
	const status = err instanceof ProviderError ? err.status : err?.status;
	if (status === 401 || status === 403) return { code: "AUTH", message: err.message };
	if (status === 402) return { code: "QUOTA", message: err.message };
	if (status === 429) return { code: "RATE_LIMIT", message: err.message };
	return { code: "INVALID_REQUEST", message: err?.message ?? String(err) };
}

function modelInfo(id) {
	const catalogId = resolveModelAlias(id);
	const hit = CLINE_MODEL_CATALOG.find((model) => model.id === catalogId);
	const base = hit ?? { id: catalogId, name: catalogId, contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: DEFAULT_MAX_TOKENS };
	return { ...base, input: ["text"] };
}

export function createClineAdapter({
	baseURL,
	resolveKey,
	fetchImpl,
	headersFor,
	missingKeyError = () => Object.assign(new Error("Cline API key is missing; fill Cline in <DSH_HOME>/cline.json"), { code: "MISSING_CREDENTIAL" }),
} = {}) {
	const resolve = async () => {
		const resolved = await resolveKey();
		if (!resolved?.apiKey) throw missingKeyError();
		return resolved.apiKey;
	};

	return {
		providerInfo: () => ({ id: "cline", name: "Cline" }),

		async listModels() {
			return CLINE_MODEL_CATALOG.map((model) => ({ ...model, input: ["text"] }));
		},

		async resolveModel(_provider, model) {
			return modelInfo(typeof model === "string" ? model : model?.id);
		},

		async prepareCall(_provider, model, prepareSignal) {
			const resolved = modelInfo(typeof model === "string" ? model : model?.id);
			const apiKey = await resolve();
			return {
				model: resolved,
				stream: (options) => streamCall({
					...options,
					model: resolved,
					apiKey,
					baseURL,
					fetchImpl,
					headers: headersFor?.(options?.sessionId) ?? {},
					signal: options?.signal ?? prepareSignal,
				}),
			};
		},
	};
}

async function* streamCall({ model, messages, system, tools, temperature, maxTokens, signal, apiKey, baseURL, fetchImpl, headers }) {
	const queue = createQueue();
	const pump = async () => {
		let nextIndex = 0;
		let open;
		const closeOpen = () => {
			if (!open) return;
			queue.push({ type: "block-end", index: open.index, block: { type: open.type, text: open.text } });
			open = undefined;
		};
		const startBlock = (type) => {
			closeOpen();
			open = { index: nextIndex, type, text: "" };
			nextIndex += 1;
			queue.push({ type: "block-start", index: open.index, blockType: type });
		};
		const delta = (type, text) => {
			if (!open || open.type !== type) startBlock(type);
			open.text += text;
			queue.push({ type: type === "text" ? "text-delta" : "reasoning-delta", index: open.index, text });
		};

		try {
			const client = new OpenAIClient({ baseURL, apiKey, model: model.id, headers, fetchImpl });
			const reply = await client.chat({
				messages: toWireMessages(messages, system),
				tools: toClientTools(tools),
				temperature,
				maxTokens: maxTokens ?? model.maxTokens,
				signal,
				onText: (text) => delta("text", text),
				onReasoning: (text) => delta("reasoning", text),
			});
			closeOpen();
			for (const call of reply.toolCalls) {
				const index = nextIndex;
				nextIndex += 1;
				const id = call.toolCallId ?? `call_${index}`;
				const name = call.toolName ?? "";
				let args;
				try {
					args = JSON.stringify(call.input ?? {});
				} catch {
					args = "{}";
				}
				queue.push({ type: "block-start", index, blockType: "tool-call" });
				queue.push({ type: "tool-call-delta", index, id, name, argumentsDelta: args });
				queue.push({ type: "block-end", index, block: { type: "tool-call", id, name, arguments: args } });
			}
			const inputTokens = reply.usage?.inputTokens ?? 0;
			const outputTokens = reply.usage?.outputTokens ?? 0;
			queue.push({ type: "usage", usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens } });
			queue.push({ type: "finish", reason: { kind: finishKind(reply.finishReason, reply.toolCalls.length) } });
		} catch (err) {
			closeOpen();
			const failure = describeFailure(err);
			if (failure.aborted) queue.push({ type: "finish", reason: { kind: "aborted" } });
			else queue.push({ type: "finish", reason: { kind: "error", failure: { message: failure.message, code: failure.code } } });
		} finally {
			queue.close();
		}
	};
	pump();
	for await (const chunk of queue) yield chunk;
}