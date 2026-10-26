const DEFAULT_LOOP_THRESHOLDS = { softThreshold: 3, hardThreshold: 5 };

function stableStringify(value) {
	if (value == null) return "null";
	if (typeof value === "string") return value;
	if (typeof value !== "object") return String(value);
	try {
		return JSON.stringify(sortKeys(value));
	} catch {
		return String(value);
	}
}

function sortKeys(value) {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value && typeof value === "object") {
		const out = {};
		for (const k of Object.keys(value).sort()) out[k] = sortKeys(value[k]);
		return out;
	}
	return value;
}

export class LoopTracker {
	constructor(options = {}) {
		this.softThreshold = options.softThreshold ?? DEFAULT_LOOP_THRESHOLDS.softThreshold;
		this.hardThreshold = options.hardThreshold ?? DEFAULT_LOOP_THRESHOLDS.hardThreshold;
		this.reset();
	}

	reset() {
		this.lastToolName = undefined;
		this.lastSignature = undefined;
		this.count = 0;
	}

	inspect({ name, input }) {
		const sig = stableStringify(input);
		if (this.lastToolName === name && this.lastSignature === sig) {
			this.count += 1;
		} else {
			this.count = 1;
		}
		this.lastToolName = name;
		this.lastSignature = sig;

		if (this.count >= this.hardThreshold) {
			return {
				kind: "hard",
				message: `Detected ${this.count} consecutive identical calls to \`${name}\`; stopping to avoid a loop.`,
			};
		}
		if (this.count === this.softThreshold) {
			return {
				kind: "soft",
				message: `Detected ${this.count} consecutive identical calls to \`${name}\`; consider trying a different approach.`,
			};
		}
		return { kind: "ok" };
	}
}

export class MistakeTracker {
	constructor({ maxConsecutiveMistakes, onLimitReached, onLimitTelemetry, emit, log, agentId, getConversationId, getActiveRunId }) {
		this.max = maxConsecutiveMistakes;
		this.onLimitReached = onLimitReached;
		this.onLimitTelemetry = onLimitTelemetry;
		this.emit = emit ?? (() => {});
		this.log = log ?? (() => {});
		this.agentId = agentId;
		this.getConversationId = getConversationId ?? (() => undefined);
		this.getActiveRunId = getActiveRunId ?? (() => undefined);
		this.count = 0;
	}

	async record({ iteration, reason, details, forceAtLimit }) {
		const max = this.max;
		const n = forceAtLimit && max ? max : this.count + 1;
		this.count = n;
		const summary = details?.trim() || `consecutive mistake (${reason})`;
		this.emit({ type: "error", error: new Error(summary), recoverable: true, iteration });
		this.log("warn", "Recorded consecutive mistake", {
			agentId: this.agentId,
			conversationId: this.getConversationId(),
			runId: this.getActiveRunId(),
			iteration, reason, details,
			consecutiveMistakes: n,
			maxConsecutiveMistakes: max,
		});

		if (!max || n < max) return { action: "continue" };

		const info = { iteration, consecutiveMistakes: n, maxConsecutiveMistakes: max, reason, details };
		this.onLimitTelemetry?.(info);
		const decision = await resolveLimitDecision(info, this.onLimitReached);
		if (decision.action === "continue") {
			this.count = 0;
			return { action: "continue", guidance: decision.guidance?.trim() || undefined };
		}
		return {
			action: "stop",
			reason: decision.reason?.trim() || undefined,
			message: formatStopMessage({ ...info, stopReason: decision.reason }),
		};
	}

	reset() {
		this.count = 0;
	}

	get value() {
		return this.count;
	}
}

async function resolveLimitDecision(info, handler) {
	if (!handler) {
		return { action: "stop", reason: `maximum consecutive mistakes reached (${info.maxConsecutiveMistakes})` };
	}
	try {
		return await handler(info);
	} catch (err) {
		return {
			action: "stop",
			reason: err instanceof Error ? err.message : `maximum consecutive mistakes reached (${info.maxConsecutiveMistakes})`,
		};
	}
}

export function formatStopMessage({ iteration, consecutiveMistakes, maxConsecutiveMistakes, reason, details, stopReason }) {
	const parts = [
		`Stopped after ${consecutiveMistakes}/${maxConsecutiveMistakes} consecutive mistakes (${reason}) at iteration ${iteration}.`,
	];
	const d = details?.trim();
	if (d) parts.push(`Error: ${d}`);
	const r = stopReason?.trim();
	if (r) parts.push(`Decision: ${r}`);
	parts.push("Session state was preserved. Send a new prompt to resume from the latest state.");
	return parts.join(" ");
}

export const COMPACTION_THRESHOLD_RATIO = 0.9;
export const CHARS_PER_TOKEN = 4;
export const DEFAULT_CONTEXT_WINDOW = 128000;

export function estimateTokens(text) {
	if (!text) return 0;
	return Math.ceil(String(text).length / CHARS_PER_TOKEN);
}

export function countMessageTokens(messages) {
	let total = 0;
	for (const m of messages) {
		if (typeof m.content === "string") {
			total += estimateTokens(m.content);
		} else if (Array.isArray(m.content)) {
			for (const part of m.content) {
				if (part?.type === "text") total += estimateTokens(part.text);
				else if (part?.type === "tool-call") total += estimateTokens(part.arguments) + 8;
				else if (part?.type === "tool-result") total += estimateTokens(part.response) + 8;
			}
		}
		total += 4;
	}
	return total;
}

export function shouldCompact({ inputTokens, maxInputTokens, ratio = COMPACTION_THRESHOLD_RATIO }) {
	return inputTokens >= maxInputTokens * ratio;
}

export function planCompaction({ messages, inputTokens, maxInputTokens, ratio = COMPACTION_THRESHOLD_RATIO, keepRecent }) {
	const target = Math.floor(maxInputTokens * ratio * 0.6);
	const keep = keepRecent ?? Math.max(2, Math.min(8, Math.ceil(messages.length * 0.25)));
	const head = messages.slice(0, messages.length - keep);
	const tail = messages.slice(-keep);
	return {
		target,
		keep,
		head,
		tail,
		messageTokens: countMessageTokens(messages),
		triggered: shouldCompact({ inputTokens, maxInputTokens, ratio }),
	};
}

export const COMPACTION_MODES = ["agentic", "basic", "off"];

export function normalizeCompactionMode(mode) {
	const m = String(mode ?? "agentic").trim().toLowerCase();
	return COMPACTION_MODES.includes(m) ? m : "agentic";
}
