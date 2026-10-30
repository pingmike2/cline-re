import http from "node:http";

export async function startMock({ frames, status = 200, body } = {}) {
	const requests = [];
	const server = http.createServer(async (req, res) => {
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		let json;
		try {
			json = JSON.parse(Buffer.concat(chunks).toString() || "{}");
		} catch {
			json = undefined;
		}
		requests.push({ url: req.url, headers: req.headers, body: json });
		if (status !== 200) {
			res.writeHead(status, { "content-type": "application/json" });
			res.end(JSON.stringify(body ?? { error: { message: "mock failure" } }));
			return;
		}
		res.writeHead(200, { "content-type": "text/event-stream" });
		const list = typeof frames === "function" ? frames(json) : frames ?? [];
		for (const frame of list) res.write(`data: ${JSON.stringify(frame)}\n\n`);
		res.end("data: [DONE]\n\n");
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();
	return {
		url: `http://127.0.0.1:${port}/v1`,
		requests,
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}