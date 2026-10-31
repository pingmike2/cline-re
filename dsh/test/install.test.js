import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "..", "install.mjs");
const pluginDir = path.resolve(here, "..");

function profile() {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-install-"));
	const dir = path.join(home, "profiles", "desktop");
	fs.mkdirSync(dir, { recursive: true });
	const manifest = path.join(dir, "package.json");
	fs.writeFileSync(manifest, JSON.stringify({ name: "p", dependencies: {}, dsh: { profile: { bundles: ["other"] } } }, null, 2));
	return { home, dir, manifest, link: path.join(dir, "node_modules", "dsh-cline") };
}

const run = (home, ...args) =>
	spawnSync(process.execPath, [script, ...args], { env: { ...process.env, DSH_HOME: home }, encoding: "utf8" });

test("install links the plugin and registers the bundle", () => {
	const p = profile();
	const r = run(p.home);
	assert.equal(r.status, 0, r.stderr);
	const json = JSON.parse(fs.readFileSync(p.manifest, "utf8"));
	assert.equal(json.dependencies["dsh-cline"], `link:${pluginDir.split(path.sep).join("/")}`);
	assert.deepEqual(json.dsh.profile.bundles, ["other", "dsh-cline"]);
	assert.equal(fs.realpathSync(p.link), fs.realpathSync(pluginDir));
});

test("install is idempotent", () => {
	const p = profile();
	assert.equal(run(p.home).status, 0);
	assert.equal(run(p.home).status, 0);
	const json = JSON.parse(fs.readFileSync(p.manifest, "utf8"));
	assert.deepEqual(json.dsh.profile.bundles, ["other", "dsh-cline"]);
});

test("dry-run writes nothing", () => {
	const p = profile();
	const before = fs.readFileSync(p.manifest, "utf8");
	const r = run(p.home, "--dry-run");
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /\[dry-run\]/);
	assert.equal(fs.readFileSync(p.manifest, "utf8"), before);
	assert.equal(fs.existsSync(p.link), false);
});

test("remove undoes install and stays idempotent", () => {
	const p = profile();
	assert.equal(run(p.home).status, 0);
	assert.equal(run(p.home, "--remove").status, 0);
	const json = JSON.parse(fs.readFileSync(p.manifest, "utf8"));
	assert.equal(json.dependencies["dsh-cline"], undefined);
	assert.deepEqual(json.dsh.profile.bundles, ["other"]);
	assert.equal(fs.existsSync(p.link), false);
	assert.equal(run(p.home, "--remove").status, 0);
});

test("missing profile manifest fails with a clear message", () => {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-install-"));
	const r = run(home);
	assert.equal(r.status, 1);
	assert.match(r.stderr, /profile manifest not found/);
});

test("--profile selects another profile directory", () => {
	const p = profile();
	const alt = path.join(p.home, "profiles", "work");
	fs.mkdirSync(alt, { recursive: true });
	const manifest = path.join(alt, "package.json");
	fs.writeFileSync(manifest, JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }));
	const r = run(p.home, "--profile", "work");
	assert.equal(r.status, 0, r.stderr);
	assert.deepEqual(JSON.parse(fs.readFileSync(manifest, "utf8")).dsh.profile.bundles, ["dsh-cline"]);
	assert.equal(fs.existsSync(path.join(p.dir, "node_modules")), false);
});
