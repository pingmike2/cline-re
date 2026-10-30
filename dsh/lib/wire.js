const NON_TEXT_PLACEHOLDER = {
	image: "[image omitted: this route accepts text only]",
	file: "[file attachment omitted]",
};

export function textOf(content) {
	if (typeof content === "string") return content;
	const blocks = Array.isArray(content) ? content : [];
	const parts = [];
	for (const block of blocks) {
		if (!block || typeof block !== "object") continue;
		if (block.type === "text") parts.push(String(block.text ?? ""));
		else if (block.type === "reasoning") continue;
		else if (block.type === "tool-call") continue;
		else if (NON_TEXT_PLACEHOLDER[block.type]) parts.push(NON_TEXT_PLACEHOLDER[block.type]);
	}
	return parts.join("");
}

export function toolCallArguments(block) {
	const raw = block.arguments;
	if (typeof raw === "string") return raw || "{}";
	if (raw == null) return "{}";
	try {
		return JSON.stringify(raw);
	} catch {
		return "{}";
	}
}

export function toWireMessages(messages = [], system) {
	const out = [];
	if (typeof system === "string" && system.length > 0) out.push({ role: "system", content: system });
	for (const message of messages) {
		if (!message || typeof message !== "object") continue;
		const blocks = Array.isArray(message.content) ? message.content : [];
		switch (message.role) {
			case "system":
			case "developer":
				out.push({ role: "system", content: textOf(blocks) });
				break;
			case "user":
				out.push({ role: "user", content: textOf(blocks) });
				break;
			case "assistant": {
				const content = textOf(blocks);
				const calls = blocks.filter((b) => b?.type === "tool-call");
				const wire = { role: "assistant", content: content.length > 0 ? content : calls.length > 0 ? null : "" };
				if (calls.length > 0) {
					wire.tool_calls = calls.map((call) => ({
						id: call.id,
						type: "function",
						function: { name: call.name, arguments: toolCallArguments(call) },
					}));
				}
				out.push(wire);
				break;
			}
			case "tool": {
				const content = textOf(blocks);
				out.push({
					role: "tool",
					tool_call_id: message.toolCallId,
					content: message.isError ? `Error: ${content}` : content,
				});
				break;
			}
			default:
				break;
		}
	}
	return out;
}

export function toClientTools(tools = []) {
	const specs = [];
	for (const tool of tools) {
		if (!tool?.name) continue;
		specs.push({
			name: tool.name,
			description: tool.description ?? "",
			inputSchema: tool.parameters ?? { type: "object", properties: {} },
		});
	}
	return specs.length > 0 ? specs : undefined;
}

export function finishKind(reason, toolCallCount = 0) {
	if (toolCallCount > 0) return "tool-calls";
	if (reason === "length" || reason === "max_tokens") return "max-tokens";
	return "stop";
}