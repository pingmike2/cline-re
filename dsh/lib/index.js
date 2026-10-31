import { createRequire } from "node:module";
import path from "node:path";
import { clineHeaders } from "../../src/index.js";
import { DEFAULT_MODEL } from "../../src/models.js";
import { createClineAdapter } from "./provider.js";
import { createClineTool } from "./tool.js";
import {
	createKeyResolver,
	missingCredentialError,
	normalizeConfig,
	PLUGIN_NAME,
	resolveDshDependency,
} from "./settings.js";

// DSH ships @deepseek-ai/schemastery next to its own runtime, not inside each
// profile, so fall back to resolving it through the DSH install. Without this the
// plugin only loads in profiles that happen to have schemastery hoisted into them.
function loadSchema() {
	try {
		return createRequire(import.meta.url)("@deepseek-ai/schemastery");
	} catch (err) {
		const resolved = resolveDshDependency("@deepseek-ai/schemastery");
		if (!resolved) throw err;
		return createRequire(path.join(path.dirname(resolved), "noop.js"))(resolved);
	}
}

const z = loadSchema();

export const name = PLUGIN_NAME;
export const inject = ["tools", "llm"];

/** Row configuration: editable in DSH → Plugins → dsh-cline → Configure. */
export const Config = z.object({
	apiKey: z.string().role("secret").volatile().default(""),
	baseURL: z.string().default("https://api.cline.bot/api/v1").volatile(),
	model: z.string().default(DEFAULT_MODEL).volatile(),
	defaultCwd: z.string().default(""),
	maxIterations: z.number().step(1).min(0).default(0),
	enableTool: z.boolean().default(true),
	enableProvider: z.boolean().default(true),
	keyFile: z.string().default(""),
});

function settingsNamespace(ctx) {
	return ctx?.fiber?.entry?.options?.id ?? PLUGIN_NAME;
}

export function apply(ctx, rawConfig) {
	const config = normalizeConfig(rawConfig);
	const resolveKey = createKeyResolver({ config });
	const warn = (err) => {
		try {
			ctx.logger?.warn?.(`[dsh-cline] ${err?.message ?? err}`);
		} catch {
			// logging is best-effort
		}
	};
	const effect = (run) => {
		if (typeof ctx.effect === "function") ctx.effect(run);
		else run();
	};

	if (config.enableProvider) {
		effect(() => {
			try {
				ctx.llm.registerAdapter(["cline"], createClineAdapter({
					baseURL: config.baseURL,
					resolveKey,
					missingKeyError: () => missingCredentialError(config),
					headersFor: (sessionId) => ({
						...clineHeaders(),
						...(sessionId ? { "X-Task-ID": String(sessionId) } : {}),
					}),
				}));
			} catch (err) {
				warn(err);
			}
		});
		if (typeof ctx.llm.registerConfigurableProviders === "function") {
			effect(() => {
				try {
					ctx.llm.registerConfigurableProviders([{
						provider: "cline",
						displayName: "Cline",
						settingsNs: settingsNamespace(ctx),
						settingsPath: [],
					}]);
				} catch (err) {
					warn(err);
				}
			});
		}
	}

	if (config.enableTool) {
		effect(() => {
			try {
				ctx.tools.register(createClineTool({ config, resolveKey }));
			} catch (err) {
				warn(err);
			}
		});
	}
}