#!/usr/bin/env node
// Installs the dsh-cline bundle row into the current DSH profile.
// Works on Windows, macOS and Linux -- no PowerShell required.
//
//   node dsh/install.mjs                 install
//   node dsh/install.mjs --remove        uninstall (restores nothing else)
//   node dsh/install.mjs --dry-run       print the plan, touch nothing
//   node dsh/install.mjs --profile work  use a profile other than "desktop"
//
// Files: <DSH_HOME>/profiles/<profile>/package.json
// Link:  <DSH_HOME>/profiles/<profile>/node_modules/dsh-cline -> this dir
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dshHome } from "./lib/settings.js";

const PLUGIN = "dsh-cline";
const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
	const opts = { remove: false, dryRun: false, profile: process.env.DSH_PROFILE || "desktop" };
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i];
		if (a === "--remove" || a === "-r") opts.remove = true;
		else if (a === "--dry-run" || a === "-n") opts.dryRun = true;
		else if (a === "--profile" || a === "-p") opts.profile = argv[++i];
		else if (a === "--help" || a === "-h") opts.help = true;
		else throw new Error(`unknown argument: ${a}`);
	}
	return opts;
}

const USAGE = `Usage: node dsh/install.mjs [--remove] [--dry-run] [--profile <name>]

  --remove, -r          unlink the plugin from the profile
  --dry-run, -n         show what would change, write nothing
  --profile, -p <name>  DSH profile to install into (default: $DSH_PROFILE or "desktop")

Environment:
  DSH_HOME     DSH data root (default: ~/.dsh on every platform)
  DSH_PROFILE  profile name when --profile is omitted
`;

function readManifest(file) {
	let raw;
	try {
		raw = fs.readFileSync(file, "utf8");
	} catch {
		throw new Error(`profile manifest not found: ${file}\nStart DSH once so it creates the profile, or pass --profile.`);
	}
	try {
		return { json: JSON.parse(raw), raw };
	} catch (err) {
		throw new Error(`profile manifest is not valid JSON (${file}): ${err.message}`);
	}
}

function writeManifest(file, json) {
	// Match the surrounding project conventions: two-space indent, trailing newline.
	const text = `${JSON.stringify(json, null, 2)}\n`;
	fs.writeFileSync(file, text, "utf8");
}

function ensureBundles(json) {
	json.dsh = json.dsh && typeof json.dsh === "object" ? json.dsh : {};
	json.dsh.profile = json.dsh.profile && typeof json.dsh.profile === "object" ? json.dsh.profile : {};
	const bundles = Array.isArray(json.dsh.profile.bundles) ? json.dsh.profile.bundles : [];
	json.dsh.profile.bundles = bundles;
	return bundles;
}

function linkTarget(pluginDir) {
	return `link:${pluginDir.split(path.sep).join("/")}`;
}

function removeLink(linkPath) {
	let st;
	try {
		st = fs.lstatSync(linkPath);
	} catch {
		return "absent";
	}
	if (st.isSymbolicLink() || st.isDirectory()) {
		// A directory from an interrupted install is removed too, but never a real
		// package tree that happens to live there: junctions/symlinks are the only
		// thing this script creates.
		if (st.isSymbolicLink()) {
			fs.unlinkSync(linkPath);
			return "unlinked";
		}
		fs.rmSync(linkPath, { recursive: true, force: true });
		return "removed";
	}
	fs.unlinkSync(linkPath);
	return "unlinked";
}

function createLink(linkPath, pluginDir) {
	fs.mkdirSync(path.dirname(linkPath), { recursive: true });
	removeLink(linkPath);
	// "junction" is ignored on POSIX and gives Windows a link that needs no admin
	// rights; elsewhere it degrades to a plain directory symlink.
	fs.symlinkSync(pluginDir, linkPath, "junction");
	return fs.realpathSync(linkPath);
}

function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		console.log(USAGE);
		return 0;
	}

	const home = dshHome(process.env);
	const profileDir = path.join(home, "profiles", opts.profile);
	const manifestPath = path.join(profileDir, "package.json");
	const linkPath = path.join(profileDir, "node_modules", PLUGIN);

	const { json } = readManifest(manifestPath);
	ensureBundles(json);
	json.dependencies = json.dependencies && typeof json.dependencies === "object" ? json.dependencies : {};

	const tag = opts.dryRun ? "[dry-run] " : "";

	if (opts.remove) {
		delete json.dependencies[PLUGIN];
		json.dsh.profile.bundles = json.dsh.profile.bundles.filter((b) => b !== PLUGIN);
		console.log(`${tag}remove ${PLUGIN} from ${manifestPath}`);
		console.log(`${tag}unlink ${linkPath}`);
		if (!opts.dryRun) {
			writeManifest(manifestPath, json);
			const outcome = removeLink(linkPath);
			console.log(outcome === "absent" ? "already absent" : `unlinked (${outcome})`);
			console.log("Restart DSH to complete removal.");
		}
		return 0;
	}

	json.dependencies[PLUGIN] = linkTarget(HERE);
	if (!json.dsh.profile.bundles.includes(PLUGIN)) json.dsh.profile.bundles.push(PLUGIN);

	console.log(`${tag}profile:  ${manifestPath}`);
	console.log(`${tag}dependency ${PLUGIN} = ${linkTarget(HERE)}`);
	console.log(`${tag}bundles: ${json.dsh.profile.bundles.join(", ")}`);
	console.log(`${tag}link:    ${linkPath} -> ${HERE}`);

	if (opts.dryRun) return 0;

	writeManifest(manifestPath, json);
	const resolved = createLink(linkPath, HERE);
	console.log(`linked:  ${resolved}`);
	console.log(`key file: ${path.join(home, "cline.json")}   <- put {"apiKey":"..."} here`);
	console.log("Restart DSH to load the bundle row.");
	return 0;
}

try {
	process.exitCode = main();
} catch (err) {
	console.error(`error: ${err.message}`);
	process.exitCode = 1;
}
