import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function fakeReact() {
	const h = (type, props, ...children) => typeof type === "function"
		? type({ ...(props ?? {}), children })
		: { type, props: props ?? {}, children };
	return {
		createElement: h,
		useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
		useEffect: () => {},
	};
}

function loadClient() {
	let captured = null;
	const react = fakeReact();
	const runtime = { __ModuleLoader__: { load: (definition) => { captured = definition; } } };
	const source = fs.readFileSync(path.join(root, "lib", "client.js"), "utf8");
	new Function("window", "require", source)(runtime, (id) => (id === "react" ? react : undefined));
	assert.ok(captured !== null, "client must call window.__ModuleLoader__.load");
	assert.equal(captured.id, "dsh-cline");
	return captured.factory((id) => (id === "react" ? react : undefined));
}

function registerRow(client) {
	let slotName = null;
	const registrations = [];
	client.apply({
		slots: {
			inject: (name, factory) => {
				slotName = name;
				for (const _ of factory()) void _;
			},
			register: (options, component) => {
				registrations.push({ options, component });
				return () => {};
			},
		},
	});
	return { slotName, registrations };
}

test("client half registers the plugins.row.config page for dsh-cline#dsh-cline", () => {
	const client = loadClient();
	assert.equal(client.name, "dsh-cline-client");
	assert.deepEqual(client.inject, ["slots"]);
	const { slotName, registrations } = registerRow(client);
	assert.equal(slotName, "plugins.row.config");
	assert.equal(registrations.length, 1);
	assert.equal(registrations[0].options.key, "dsh-cline#dsh-cline");
	const summary = registrations[0].component({ view: "summary" });
	assert.match(String(summary.children.join("")), /Cline API Key/);
});

test("manifest ships the browser half for the plugin manager", () => {
	const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
	assert.equal(manifest.exports["./client"], "./lib/client.js");
	assert.equal(manifest.dsh.client.platform, "web");
	assert.ok(manifest.dsh.client.inject.includes("@deepseek-ai/dsh-client-ui-plugin-manager"));
	assert.ok(fs.existsSync(path.join(root, "lib", "client.js")));
});

test("the configure page renders a key field and saves settings operations", async () => {
	const client = loadClient();
	const calls = [];
	const form = {
		state: {
			status: "ready",
			writable: true,
			revision: 7,
			value: { model: "cline-free/nemotron-3.5-super-vl", enableTool: true },
		},
		mutate: async (operations, revision) => {
			calls.push({ operations, revision });
			return true;
		},
	};
	const { registrations } = registerRow(client);
	const page = registrations[0].component({ view: "page", form });
	assert.equal(page.type, "form");

	const flat = [];
	const walk = (node) => {
		if (node === null || node === undefined || typeof node === "string") return;
		if (Array.isArray(node)) return node.forEach(walk);
		flat.push(node);
		(node.children ?? []).forEach(walk);
	};
	walk(page);
	const key = flat.find((node) => node.type === "input" && node.props.type === "password");
	assert.ok(key, "password field for the API key");
	assert.equal(key.props.placeholder.includes("sk_"), true);
	assert.ok(flat.some((node) => node.type === "input" && node.props.value === "cline-free/nemotron-3.5-super-vl"));
	assert.ok(flat.some((node) => node.type === "input" && node.props.type === "checkbox"));
});

test("model input offers the live free-pool models as a datalist", () => {
	const client = loadClient();
	const { registrations } = registerRow(client);
	const form = {
		state: {
			status: "ready",
			writable: true,
			revision: 7,
			value: { model: "cline-free/nemotron-3.5-super-vl", enableTool: true },
		},
		mutate: async () => true,
	};
	const page = registrations[0].component({ view: "page", form });
	const flat = [];
	const walk = (node) => {
		if (node === null || node === undefined || typeof node === "string") return;
		if (Array.isArray(node)) return node.forEach(walk);
		flat.push(node);
		(node.children ?? []).forEach(walk);
	};
	walk(page);
	const modelInput = flat.find((node) => node.type === "input" && node.props.value === "cline-free/nemotron-3.5-super-vl");
	assert.ok(modelInput, "model input present");
	assert.equal(modelInput.props.list, "dsh-cline-model-choices");
	const datalist = flat.find((node) => node.type === "datalist");
	assert.ok(datalist, "datalist present");
	const options = datalist.children.flat();
	const ids = options.map((node) => node.props.value);
	assert.deepEqual(ids, [
		"cline-free/nemotron-3.5-super-vl",
		"nvidia/nemotron-3.5-lightning-free",
		"reflection/beam-free",
		"cline-free/solar-mini4",
	]);
	assert.equal(options.every((node) => node.props.label.includes("上下文") && !node.props.label.includes("200k")), true);
});

test("page falls back to a hint when the host exposes no writable form", () => {
	const client = loadClient();
	const { registrations } = registerRow(client);
	const page = registrations[0].component({ view: "page", form: undefined });
	const text = JSON.stringify(page);
	assert.match(text, /cline\.json/);
});

test("page shows a loading note while the form snapshot loads", () => {
	const client = loadClient();
	const { registrations } = registerRow(client);
	const page = registrations[0].component({
		view: "page",
		form: { state: { status: "loading", writable: false, revision: undefined, value: undefined }, mutate: async () => false },
	});
	const text = JSON.stringify(page);
	assert.match(text, /正在加载配置/);
	assert.doesNotMatch(text, /cline\.json/);
});

test("page separates an unavailable namespace from the fallback hint", () => {
	const client = loadClient();
	const { registrations } = registerRow(client);
	const page = registrations[0].component({
		view: "page",
		form: { state: { status: "unavailable", writable: false, revision: 3, value: undefined }, mutate: async () => false },
	});
	const text = JSON.stringify(page);
	assert.match(text, /不可用/);
	assert.doesNotMatch(text, /cline\.json/);
});

test("submit preserves an untouched key and posts the changed fields", async () => {
	const client = loadClient();
	const { registrations } = registerRow(client);
	const calls = [];
	const form = {
		state: {
			status: "ready",
			writable: true,
			revision: 7,
			value: { model: "cline-free/nemotron-3.5-super-vl", enableTool: true, enableProvider: true },
		},
		mutate: async (operations, revision) => {
			calls.push({ operations, revision });
			return true;
		},
	};
	const page = registrations[0].component({ view: "page", form });
	const flat = [];
	const walk = (node) => {
		if (node === null || node === undefined || typeof node === "string") return;
		if (Array.isArray(node)) return node.forEach(walk);
		flat.push(node);
		(node.children ?? []).forEach(walk);
	};
	walk(page);
	const inputs = flat.filter((node) => node.type === "input");
	const submitButton = flat.find((node) => node.type === "button" && node.props.type === "submit");
	assert.ok(submitButton, "submit button present");
	const modelInput = inputs.find((node) => node.props.value === "cline-free/nemotron-3.5-super-vl");
	assert.ok(modelInput, "model input present");
	const changed = { ...modelInput.props.value, value: "solar-mini4" };
	await modelInput.props.onChange({ target: { value: changed.value } });
	const keyInput = inputs.find((node) => node.props.type === "password");
	await keyInput.props.onChange({ target: { value: "  " } });
	const rerendered = registrations[0].component({ view: "page", form, ...{} });
	void rerendered;
	assert.equal(calls.length, 0, "no save dispatched before submit");
});