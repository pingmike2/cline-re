import path from "node:path";
import { CLINE_API_BASE, clineHeaders, createAgent } from "../../src/index.js";
import { resolveModelAlias } from "../../src/models.js";
import { missingCredentialError } from "./settings.js";

const DESCRIPTION = [
	"Delegate one self-contained coding task to a Cline agent (the cline-re runtime) and return its final answer.",
	"The Cline agent runs in `cwd` with its own tools (read_files, editor, run_commands, search_codebase) and can modify files there,",
	"so give it a complete instruction and do not duplicate its work. `mode: \"plan\"` is read-only; `act` edits files; `yolo` skips confirmation prompts.",
].join(" ");

export function createClineTool({ config, resolveKey, env = process.env }) {
	return {
		name: "cline",
		description: DESCRIPTION,
		parameters: {
			type: "object",
			additionalProperties: false,
			required: ["prompt"],
			properties: {
				prompt: { type: "string", description: "The complete task for the Cline agent." },
				cwd: { type: "string", description: "Working directory for the Cline agent; defaults to the plugin's defaultCwd or the process directory." },
				mode: { type: "string", enum: ["act", "plan", "yolo"], description: "act (default) edits files, plan is read-only, yolo runs headless." },
				model: { type: "string", description: "Cline model id or alias (nemotron is the default; solar-mini4, lightning, laguna, beam also work)." },
				maxIterations: { type: "integer", description: "Hard cap on Cline agent iterations." },
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				required: ["status", "iterations", "output"],
				properties: {
					status: { type: "string" },
					iterations: { type: "integer" },
					output: { type: "string" },
				},
			},
			render: (_args, value) => [{ type: "text", text: value.output || `cline ${value.status} after ${value.iterations} iteration(s)` }],
		},
		timeoutMs: 3600000,
		async execute(args, exec) {
			const prompt = String(args?.prompt ?? "").trim();
			if (!prompt) throw new Error("cline: `prompt` is required");
			const key = await resolveKey();
			if (!key.apiKey) throw missingCredentialError(config, env);
			const base = config.defaultCwd ? path.resolve(config.defaultCwd) : process.cwd();
			const cwd = args?.cwd ? path.resolve(base, args.cwd) : base;
			const mode = args?.mode ?? "act";
			const model = resolveModelAlias(args?.model ?? config.model);
			const official = config.baseURL.replace(/\/+$/, "") === CLINE_API_BASE;
			const { run } = await createAgent({
				apiKey: key.apiKey,
				baseURL: config.baseURL,
				model,
				cwd,
				mode,
				maxIterations: args?.maxIterations ?? config.maxIterations,
				headers: official ? clineHeaders() : {},
			});
			const result = await run({ messages: [{ role: "user", content: prompt }], signal: exec?.signal });
			return { status: result.status, iterations: result.iterations, output: result.outputText ?? "" };
		},
	};
}