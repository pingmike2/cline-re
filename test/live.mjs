import { createAgent, CLINE_API_BASE } from "../src/index.js";

const key = process.env.CLINE_API_KEY;
if (!key) {
	console.error("missing CLINE_API_KEY");
	process.exit(2);
}

const agent = await createAgent({
	apiKey: key,
	baseURL: CLINE_API_BASE,
	model: process.env.CLINE_MODEL ?? "anthropic/claude-sonnet-4.5",
	mode: "act",
	maxIterations: 8,
	onEvent: (e) => {
		if (e.type === "iteration") console.error(`[iter ${e.iteration}]`);
		else if (e.type === "tool_start") console.error(`  -> ${e.toolName}`);
		else if (e.type === "tool_end") console.error(`  <- ${e.ok ? "ok" : "failed"} ${String(e.output).slice(0, 120)}`);
		else if (e.type === "loop") console.error(`  !! ${e.kind}`);
	},
});

const res = await agent.run({
	messages: [{ role: "user", content: "Read the file smoke.txt and reply with just its exact contents." }],
});

console.log(JSON.stringify({ status: res.status, iterations: res.iterations, outputText: res.outputText }, null, 2));
process.exit(res.status === "completed" ? 0 : 1);
