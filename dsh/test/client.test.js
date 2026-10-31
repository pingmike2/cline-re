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

test("page falls back to a hint when the host exposes no writable form", () => {
	const client = loadClient();
	const { registrations } = registerRow(client);
	const page = registrations[0].component({ view: "page", form: undefined });
	const text = JSON.stringify(page);
	assert.match(text, /cline\.json/);
});