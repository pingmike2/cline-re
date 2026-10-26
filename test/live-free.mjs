import { createAgent, CLINE_API_BASE } from "../src/index.js";
import { refreshClineToken, workosBearer } from "../src/cline-auth-api.js";

const rt = process.env.CLINE_REFRESH_TOKEN;
const tokens = await refreshClineToken(rt);
const apiKey = workosBearer(tokens.accessToken);

const agent = await createAgent({
	apiKey,
	baseURL: CLINE_API_BASE,
	model: process.env.CLINE_MODEL || "cline-free/solar-mini4",
	cwd: process.argv[2] || process.cwd(),
	headers: {
		"X-CLIENT-TYPE": "cline",
		"X-CLIENT-VERSION": "3.0.74",
		"X-CORE-VERSION": "0.2.0",
		"X-PLATFORM": "linux",
		"X-PLATFORM-VERSION": "3.0.74",
		"User-Agent": "Cline/3.0.74",
		"X-IS-MULTIROOT": "false",
		"HTTP-Referer": "https://cline.bot",
		"X-Title": "Cline",
	},
	maxIterations: 12,
});

const res = await agent.run({
	messages: [{ role: "user", content: process.env.PROMPT || "Read smoke.txt and tell me the exact token inside it. Then call submit_and_exit." }],
});
console.log(JSON.stringify({ status: res.status, iterations: res.iterations, output: res.outputText, usage: res.usage }, null, 2));
