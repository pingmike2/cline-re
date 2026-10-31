export const DEFAULT_MODEL = "cline-free/nemotron-3.5-super-vl";

export const FREE_MODELS = {
	"solar-mini4": "cline-free/solar-mini4",
	"nemotron": "cline-free/nemotron-3.5-super-vl",
	"lightning": "nvidia/nemotron-3.5-lightning-free",
	"beam": "reflection/beam-free",
};

export const CLINE_MODEL_CATALOG = [
	{ id: "cline-free/nemotron-3.5-super-vl", name: "Cline Free: Nemotron 3.5 Super VL (120B, 1M)", contextWindow: 1048576, maxTokens: 131072 },
	{ id: "nvidia/nemotron-3.5-lightning-free", name: "Cline Free: Nemotron 3.5 Lightning (1M)", contextWindow: 1000000, maxTokens: 65536 },
	{ id: "reflection/beam-free", name: "Cline Free: Beam (1M)", contextWindow: 1048576, maxTokens: 131072 },
	{ id: "cline-free/solar-mini4", name: "Cline Free: Solar Mini 4 (35B MoE, 512k)", contextWindow: 524288, maxTokens: 131072 },
];

export function resolveModelAlias(id) {
	if (typeof id !== "string" || id.length === 0) return DEFAULT_MODEL;
	return FREE_MODELS[id] ?? id;
}