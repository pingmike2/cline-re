import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

async function git(cwd, args) {
	const { stdout } = await run("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 });
	return stdout.trim();
}

export class GitCheckpointer {
	constructor({ cwd, sessionId, logger = () => {} }) {
		this.cwd = cwd;
		this.sessionId = sessionId;
		this.logger = logger;
		this.ready = false;
		this.runCount = 0;
	}

	async init() {
		try {
			this.ready = (await git(this.cwd, ["rev-parse", "--is-inside-work-tree"])) === "true";
		} catch {
			this.ready = false;
		}
		return this.ready;
	}

	ref(runCount) {
		return `refs/cline/checkpoints/${this.sessionId}/${runCount}`;
	}

	async snapshot(message = "index on cline checkpoint") {
		if (!this.ready) return undefined;
		try {
			const head = await git(this.cwd, ["rev-parse", "HEAD"]).catch(() => "");
			const indexTree = await git(this.cwd, ["write-tree"]);
			const args = ["commit-tree", indexTree, "-m", message];
			if (head) args.push("-p", head);
			const commit = await git(this.cwd, args);
			this.runCount += 1;
			await git(this.cwd, ["update-ref", this.ref(this.runCount), commit]);
			return { ref: commit, runCount: this.runCount, createdAt: Date.now() };
		} catch (err) {
			this.logger(`checkpoint failed: ${err.message}`);
			return undefined;
		}
	}

	async restore(runCount) {
		if (!this.ready) return false;
		const target = await git(this.cwd, ["rev-parse", this.ref(runCount)]).catch(() => "");
		if (!target) return false;
		await git(this.cwd, ["read-tree", "--reset", "-u", target]);
		await git(this.cwd, ["checkout-index", "-a", "-f"]);
		await git(this.cwd, ["clean", "-fdq"]);
		return true;
	}

	async clear() {
		if (!this.ready) return;
		const prefix = `refs/cline/checkpoints/${this.sessionId}/`;
		const refs = await git(this.cwd, ["for-each-ref", "--format=%(refname)", prefix]).catch(() => "");
		for (const ref of refs.split("\n").filter(Boolean)) {
			await git(this.cwd, ["update-ref", "-d", ref]).catch(() => {});
		}
	}
}
