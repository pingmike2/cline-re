import fs from "node:fs";
import path from "node:path";
import { CredentialStore } from "../../src/credentials.js";
import { DEFAULT_MODEL } from "../../src/models.js";

export const PLUGIN_NAME = "dsh-cline";
export const DEFAULT_BASE_URL = "https://api.cline.bot/api/v1";

export function normalizeConfig(raw = {}) {
	const config = raw ?? {};
	return {
		apiKey: typeof config.apiKey === "string" ? config.apiKey.trim() : "",
		baseURL: typeof config.baseURL === "string" && config.baseURL ? config.baseURL : DEFAULT_BASE_URL,
		model: typeof config.model === "string" && config.model ? config.model : DEFAULT_MODEL,
		defaultCwd: typeof config.defaultCwd === "string" ? config.defaultCwd : "",
		maxIterations: Number.isInteger(config.maxIterations) && config.maxIterations > 0 ? config.maxIterations : undefined,
		enableTool: config.enableTool !== false,
		enableProvider: config.enableProvider !== false,
		keyFile: typeof config.keyFile === "string" ? config.keyFile : "",
	};
}

export function dshHome(env = process.env) {
	if (env.DSH_HOME) return env.DSH_HOME;
	const home = env.USERPROFILE || env.HOME;
	return home ? path.join(home, ".dsh") : process.cwd();
}

export function keyFilePath(config, env = process.env) {
	return config.keyFile ? path.resolve(config.keyFile) : path.join(dshHome(env), "cline.json");
}

export function readKeyFile(file) {
	try {
		const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
		return typeof parsed?.apiKey === "string" ? parsed.apiKey.trim() : "";
	} catch {
		return "";
	}
}

export function missingCredentialError(config, env = process.env) {
	const file = keyFilePath(config, env);
	return Object.assign(
		new Error(`Cline API key missing. Write {"apiKey":"<your Cline API key>"} to ${file}, set config.apiKey, set CLINE_API_KEY, or run "cline-re login".`),
		{ code: "MISSING_CREDENTIAL" },
	);
}

export function createKeyResolver({ config, env = process.env, store } = {}) {
	const credentials = store ?? new CredentialStore();
	return async function resolveKey() {
		if (config.apiKey) return { apiKey: config.apiKey, source: "config" };
		const fromFile = readKeyFile(keyFilePath(config, env));
		if (fromFile) return { apiKey: fromFile, source: "cline.json" };
		const fromEnv = String(env.CLINE_API_KEY ?? "").trim();
		if (fromEnv) return { apiKey: fromEnv, source: "CLINE_API_KEY" };
		try {
			return { apiKey: await credentials.getAccessToken(), source: "cline login" };
		} catch {
			return { apiKey: "", source: "" };
		}
	};
}