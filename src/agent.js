import { LoopTracker, MistakeTracker } from "./guardrails.js";
import { canonicalToolName } from "./tools.js";

export class AgentRuntime {
	constructor({ client, tools, systemPrompt, maxIterations, maxConsecutiveMistakes = 6, cwd, mode = "act", onEvent, logger, checkpointer } = {}) {
		this.client = client;
		this.checkpointer = checkpointer;
		this.tools = new Map(tools.map((t) => [t.name, t]));
		this.systemPrompt = systemPrompt;
		this.maxIterations = maxIterations;
		this.cwd = cwd;
		this.mode = mode;
		this.onEvent = onEvent ?? (() => {});
		this.logger = logger;
		this.loop = new LoopTracker();
		this.mistake = new MistakeTracker({
			maxConsecutiveMistakes,
			emit: (e) => this.onEvent(e),
			log: logger ?? (() => {}),
		});
	}

	completionToolNames() {
		return [...this.tools.values()].filter((t) => t.lifecycle?.completesRun === true).map((t) => t.name).sort();
	}

	async run({ messages, signal }) {
		const state = { iteration: 0, messages: [...messages], usage: { inputTokens: 0, outputTokens: 0 } };
		this.onEvent({ type: "run-started", iteration: 0 });

		try {
			while (this.maxIterations === undefined || state.iteration < this.maxIterations) {
				if (signal?.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });
				state.iteration += 1;
				this.onEvent({ type: "turn-started", iteration: state.iteration });
				if (this.checkpointer) {
					const snap = await this.checkpointer.snapshot();
					if (snap) this.onEvent({ type: "checkpoint", ...snap });
				}

				const reply = await this.client.chat({
					messages: this.buildApiMessages(state.messages),
					tools: [...this.tools.values()],
					signal,
				});
				state.usage.inputTokens += reply.usage.inputTokens;
				state.usage.outputTokens += reply.usage.outputTokens;

				const assistant = { role: "assistant", content: reply.text, toolCalls: reply.toolCalls };
				state.messages.push(assistant);
				this.onEvent({ type: "message-added", message: assistant });

				if (reply.toolCalls.length === 0) {
					this.onEvent({ type: "turn-finished", iteration: state.iteration, toolCallCount: 0 });
					const names = this.completionToolNames();
					if (names.length > 0) {
						state.messages.push({ role: "user", content: `[SYSTEM] This run is not complete until you call one of these terminal completion tools: ${names.join(", ")}. Continue working if requirements are not met. If the task is complete, call the appropriate terminal completion tool now.` });
						continue;
					}
					return this.finish("completed", state, reply.text);
				}

				const results = await this.executeToolCalls(reply.toolCalls, { signal, iteration: state.iteration });
				for (const r of results) {
					state.messages.push({ role: "tool", toolCallId: r.toolCallId, content: r.content, isError: r.isError });
					this.onEvent({ type: "message-added", message: state.messages.at(-1) });
				}

				const failing = results.filter((r) => r.isError).length;
				if (failing > 0) {
					const rec = await this.mistake.record({
						iteration: state.iteration,
						reason: "tool_execution_failed",
						details: `${failing} tool call(s) failed`,
					});
					if (rec.action === "stop") return this.finish("mistake_limit", state, rec.message);
				} else {
					this.mistake.reset();
				}

				this.onEvent({ type: "turn-finished", iteration: state.iteration, toolCallCount: reply.toolCalls.length });
				const completing = results.find((r) => r.completesRun && !r.isError);
				if (completing) return this.finish("completed", state, completing.summary ?? "");
			}
			throw new Error(`Agent runtime exceeded maxIterations (${this.maxIterations})`);
		} catch (err) {
			const aborted = err?.name === "AbortError" || signal?.aborted;
			return this.finish(aborted ? "aborted" : "error", state, err.message, err);
		}
	}

	buildApiMessages(messages) {
		const out = [{ role: "system", content: this.systemPrompt }];
		for (const m of messages) {
			if (m.role === "assistant" && m.toolCalls?.length) {
				out.push({
					role: "assistant",
					content: m.content || null,
					tool_calls: m.toolCalls.map((tc) => ({
						id: tc.toolCallId,
						type: "function",
						function: { name: tc.toolName, arguments: JSON.stringify(tc.input ?? {}) },
					})),
				});
			} else if (m.role === "tool") {
				out.push({ role: "tool", tool_call_id: m.toolCallId, content: String(m.content) });
			} else {
				out.push({ role: m.role, content: m.content });
			}
		}
		return out;
	}

	async executeToolCalls(toolCalls, ctx) {
		const prepared = toolCalls.map((tc) => this.prepare(tc));
		const out = [];
		let i = 0;
		while (i < prepared.length) {
			const cur = prepared[i];
			const mode = cur.spec?.executionMode ?? "parallel";
			if (mode === "sequential") {
				out.push(await this.executeOne(cur, ctx));
				i += 1;
				continue;
			}
			let j = i;
			while (j < prepared.length && (prepared[j].spec?.executionMode ?? "parallel") === "parallel") j += 1;
			out.push(...await Promise.all(prepared.slice(i, j).map((p) => this.executeOne(p, ctx))));
			i = j;
		}
		return out;
	}

	prepare(toolCall) {
		const name = canonicalToolName(toolCall.toolName);
		const spec = this.tools.get(name);
		if (!spec) {
			return { toolCall, spec: undefined, error: `Unknown tool: ${toolCall.toolName}` };
		}
		return { toolCall: { ...toolCall, toolName: name }, spec };
	}

	async executeOne({ toolCall, spec, error }, ctx) {
		if (error) return { toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, content: error, isError: true };

		const loop = this.loop.inspect({ name: spec.name, input: toolCall.input });
		if (loop.kind === "hard") {
			return { toolCallId: toolCall.toolCallId, toolName: spec.name, content: loop.message, isError: true };
		}

		try {
			const result = await spec.execute(toolCall.input ?? {}, { ...ctx, cwd: this.cwd, mode: this.mode });
			const payload = result && typeof result === "object" && "blocked" in result && result.blocked
				? { isError: true, content: result.message }
				: { isError: false, content: typeof result === "string" ? result : JSON.stringify(result) };
			return {
				toolCallId: toolCall.toolCallId,
				toolName: spec.name,
				content: payload.content,
				isError: payload.isError,
				completesRun: spec.lifecycle?.completesRun === true ? true : undefined,
				summary: spec.name === "submit_and_exit" ? toolCall.input?.summary : undefined,
			};
		} catch (err) {
			return { toolCallId: toolCall.toolCallId, toolName: spec.name, content: `Error: ${err.message}`, isError: true };
		}
	}

	finish(status, state, outputText, error) {
		const result = {
			status,
			iterations: state.iteration,
			outputText: outputText ?? "",
			messages: state.messages,
			usage: state.usage,
			...(error ? { error: error.message } : {}),
		};
		this.onEvent({ type: "run-finished", status, result });
		return result;
	}
}
