export const DEFAULT_MODEL = "cline-free/nemotron-3.5-super-vl";

export const FREE_MODELS = {
	"solar-mini4": "cline-free/solar-mini4",
	"nemotron": "cline-free/nemotron-3.5-super-vl",
	"lightning": "nvidia/nemotron-3.5-lightning-free",
	"beam": "reflection/beam-free",
};

export const CLINE_MODEL_CATALOG = [
	{ id: "cline-free/nemotron-3.5-super-vl", name: "Cline Free: Nemotron 3.5 Super VL (120B)", contextWindow: 200000, maxTokens: 32768 },
	{ id: "nvidia/nemotron-3.5-lightning-free", name: "Cline Free: Nemotron 3.5 Lightning", contextWindow: 200000, maxTokens: 32768 },
	{ id: "reflection/beam-free", name: "Cline Free: Beam", contextWindow: 200000, maxTokens: 32768 },
	{ id: "cline-free/solar-mini4", name: "Cline Free: Solar Mini 4 (35B MoE)", contextWindow: 200000, maxTokens: 32768 },
];

export function resolveModelAlias(id) {
	if (typeof id !== "string" || id.length === 0) return DEFAULT_MODEL;
	return FREE_MODELS[id] ?? id;
}