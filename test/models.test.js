import assert from "node:assert/strict";
import test from "node:test";

import { CLINE_MODEL_CATALOG, FREE_MODELS, DEFAULT_MODEL, resolveModelAlias } from "../src/models.js";

test("default model is the flagship free-pool entry", () => {
	assert.equal(DEFAULT_MODEL, "cline-free/nemotron-3.5-super-vl");
	assert.ok(CLINE_MODEL_CATALOG.some((model) => model.id === DEFAULT_MODEL));
});

test("aliases resolve to the live free-pool model ids", () => {
	assert.equal(resolveModelAlias("nemotron"), "cline-free/nemotron-3.5-super-vl");
	assert.equal(resolveModelAlias("solar-mini4"), "cline-free/solar-mini4");
	assert.equal(resolveModelAlias("lightning"), "nvidia/nemotron-3.5-lightning-free");
	assert.equal(resolveModelAlias("beam"), "reflection/beam-free");
});

test("retired free models stay out of the alias map and catalog", () => {
	assert.equal("laguna" in FREE_MODELS, false);
	assert.ok(!CLINE_MODEL_CATALOG.some((model) => model.id.includes("laguna")));
	assert.equal(resolveModelAlias("laguna"), "laguna");
});

test("catalog entries carry the live gateway metadata", () => {
	assert.equal(CLINE_MODEL_CATALOG.length, 4);
	const expected = {
		"cline-free/nemotron-3.5-super-vl": 1048576,
		"nvidia/nemotron-3.5-lightning-free": 1000000,
		"reflection/beam-free": 1048576,
		"cline-free/solar-mini4": 524288,
	};
	for (const model of CLINE_MODEL_CATALOG) {
		assert.equal(model.contextWindow, expected[model.id]);
		assert.ok(model.maxTokens >= 65536);
		assert.match(model.id, /^[a-z0-9-]+\/[a-z0-9.-]+$/);
	}
});
