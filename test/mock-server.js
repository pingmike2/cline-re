import http from "node:http";
import fs from "node:fs/promises";

const corpus = (await import(new URL("./corpus.js", import.meta.url))).default;

export async function startMockCline() {
	const server = http.createServer(async (req, res) => {
		const chunks = [];
		for await (const c of req) chunks.push(c);
		const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");

		if (!req.url.endsWith("/chat/completions")) {
			res.writeHead(404).end("{}");
			return;
		}

		const hasToolResult = body.messages.some((m) => m.role === "tool");
		const turn = hasToolResult ? 1 : 0;
		const frames = corpus[turn];

		res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
		for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`);
		res.end("data: [DONE]\n\n");
	});

	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	const port = server.address().port;
	return { url: `http://127.0.0.1:${port}/v1`, close: () => new Promise((r) => server.close(r)) };
}
