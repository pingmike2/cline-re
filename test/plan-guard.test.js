import test from "node:test";
import assert from "node:assert/strict";
import { detectFileMutation } from "../src/plan-guard.js";

const blocked = [
	"echo hi > out.txt",
	"echo hi >> /var/log/app.log",
	"sed -i 's/a/b/' file.txt",
	"perl -i -pe 's/x/y/' f",
	"awk -i inplace '{print}' f",
	"find . -name '*.tmp' -delete",
	"find . -name x -exec rm {} ;",
	"curl https://x -o out.bin",
	"wget https://x/y",
	"tee out.txt",
	"rm -rf node_modules",
	"mv a b",
	"touch new.txt",
	"mkdir build",
	"npm install",
	"npm i left-pad",
	"pnpm add react",
	"yarn",
	"pip install requests",
	"python -m pip install requests",
	"cargo install ripgrep",
	"git commit -m x",
	"git push",
	"git checkout -b feat",
	"apt-get install -y curl",
	"brew install jq",
	"go get ./...",
	"chmod +x run.sh",
	"sort -o out.txt in.txt",
	"sudo rm -rf /tmp/x",
	"env FOO=1 rm bar",
];

const allowed = [
	"ls -la",
	"cat package.json",
	"grep -rn foo src",
	"git status",
	"git log --oneline -5",
	"git diff",
	"git stash list",
	"git worktree list",
	"npm ls",
	"npm run build",
	"python -c 'print(1)'",
	"echo hi > /tmp/out.txt",
	"echo hi > /dev/null",
	"node -e 'console.log(1)' 2>&1",
	"find . -name '*.js'",
	"cargo check",
	"rg pattern .",
	"git --help",
	"yarn --version",
];

for (const cmd of blocked) {
	test(`plan mode blocks: ${cmd}`, () => {
		assert.ok(detectFileMutation(cmd), `expected a block reason for: ${cmd}`);
	});
}

for (const cmd of allowed) {
	test(`plan mode allows: ${cmd}`, () => {
		assert.equal(detectFileMutation(cmd), undefined, `expected no block reason for: ${cmd}`);
	});
}

test("heredoc body is ignored, but surrounding redirection still blocks", () => {
	assert.equal(detectFileMutation("cat > /tmp/x <<'EOF'\nrm -rf /\nEOF"), undefined);
	assert.ok(detectFileMutation("cat > ./x <<'EOF'\nrm -rf /\nEOF"));
});

test("chained commands are inspected individually", () => {
	assert.ok(detectFileMutation("ls && rm foo"));
	assert.ok(detectFileMutation("true; git commit -m x"));
	assert.equal(detectFileMutation("ls && cd src && grep x ."), undefined);
});
