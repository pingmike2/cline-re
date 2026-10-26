const toolCallId = "toolu_01Q9kZ7wXy";

export default [
	[
		{ choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
		{ choices: [{ index: 0, delta: { content: "I'll read that file first." }, finish_reason: null }] },
		{
			choices: [{
				index: 0,
				delta: {
					tool_calls: [{
						index: 0,
						id: toolCallId,
						type: "function",
						function: { name: "read_files", arguments: '{"files":[{"path":"smoke.txt"}]}' },
					}],
				},
				finish_reason: null,
			}],
		},
		{ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
	],
	[
		{ choices: [{ index: 0, delta: { content: "The file contains: hello-from-smoke-42" }, finish_reason: null }] },
		{
			choices: [{
				index: 0,
				delta: {
					tool_calls: [{
						index: 0,
						id: "toolu_02SubmitExit",
						type: "function",
						function: { name: "submit_and_exit", arguments: '{"summary":"read smoke.txt successfully"}' },
					}],
				},
				finish_reason: null,
			}],
		},
		{ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 120, completion_tokens: 40 } },
	],
];
