const SHELL_WRAPPERS = new Set([
	"sudo", "doas", "env", "command", "builtin", "nohup", "time",
	"nice", "stdbuf", "timeout", "xargs",
]);

const SHELL_KEYWORDS = new Set([
	"if", "then", "else", "elif", "fi", "while", "until", "do", "done",
	"for", "case", "esac", "!", "{", "}",
]);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;

const FILE_MUTATORS = new Set([
	"rm", "rmdir", "unlink", "mv", "cp", "dd", "touch", "mkdir", "ln", "link",
	"chmod", "chown", "chgrp", "truncate", "shred", "install", "patch", "rsync",
	"mkfifo", "mknod", "del", "erase", "move", "ren", "rename", "md", "rd",
	"mklink", "copy", "xcopy", "robocopy", "new-item", "ni", "remove-item",
	"move-item", "copy-item", "rename-item", "set-content", "add-content",
	"clear-content", "out-file", "mi", "ri", "cpi", "rni", "ac", "clc",
]);

const GIT_WRITERS = new Set([
	"add", "am", "apply", "checkout", "cherry-pick", "clean", "clone", "commit",
	"init", "merge", "mv", "pull", "push", "rebase", "reset", "restore",
	"revert", "rm", "stash", "submodule", "switch", "worktree",
]);

const PKG_WRITERS = new Set([
	"install", "i", "ci", "add", "remove", "rm", "uninstall", "unlink", "link",
	"update", "up", "upgrade", "dedupe", "prune", "rebuild", "publish", "pack",
]);

const GIT_READONLY_SUB = {
	stash: new Set(["list", "show"]),
	worktree: new Set(["list"]),
	submodule: new Set(["status", "summary"]),
};

const CARGO_WRITERS = new Set(["install", "uninstall", "update", "add", "remove"]);
const PIP_WRITERS = new Set(["install", "uninstall", "download"]);
const GEM_WRITERS = new Set(["install", "uninstall", "update"]);
const COMPOSER_WRITERS = new Set(["install", "update", "require", "remove"]);
const GO_WRITERS = new Set(["install", "get"]);
const DOTNET_WRITERS = new Set(["add", "remove"]);
const WINGET_WRITERS = new Set(["install", "uninstall", "upgrade"]);
const NUGET_WRITERS = new Set(["install", "update", "delete", "push"]);
const APT_WRITERS = new Set([
	"install", "reinstall", "remove", "purge", "uninstall", "upgrade",
	"autoremove", "add", "del",
]);

const WRITE_SUBCOMMANDS = {
	git: GIT_WRITERS,
	npm: PKG_WRITERS, pnpm: PKG_WRITERS, yarn: PKG_WRITERS, bun: PKG_WRITERS,
	pip: PIP_WRITERS, pip3: PIP_WRITERS, pipx: PIP_WRITERS, uv: PIP_WRITERS,
	cargo: CARGO_WRITERS,
	apt: APT_WRITERS, "apt-get": APT_WRITERS, dnf: APT_WRITERS,
	yum: APT_WRITERS, apk: APT_WRITERS, brew: APT_WRITERS, snap: APT_WRITERS,
	gem: GEM_WRITERS, composer: COMPOSER_WRITERS,
	go: GO_WRITERS, dotnet: DOTNET_WRITERS,
	winget: WINGET_WRITERS, nuget: NUGET_WRITERS,
};

function isAllowedRedirectTarget(target, cwd) {
	const t = target.replace(/["']/g, "");
	if (/^(\/dev\/(null|stdout|stderr|tty)|nul:?)$/i.test(t)) return true;
	if (t.includes("..")) return false;
	const tempish = (
		t.startsWith("/tmp/") ||
		t.startsWith("/var/tmp/") ||
		t.startsWith("$TMPDIR") ||
		t.startsWith("${TMPDIR") ||
		/^%te?mp%/i.test(t) ||
		/^\$env:te?mp/i.test(t)
	);
	if (!tempish) return false;
	// A temp prefix alone is not enough: when the project itself lives under
	// /tmp, every path inside the worktree would look "safe". Reject any target
	// that resolves inside cwd so plan mode stays read-only for the project.
	if (cwd && t.startsWith("/")) {
		const root = cwd.endsWith("/") ? cwd : `${cwd}/`;
		if (t === cwd || t.startsWith(root)) return false;
	}
	return true;
}

function commandBasename(token) {
	return (token.replace(/["']/g, "").split(/[/\\]/).pop() ?? token)
		.toLowerCase()
		.replace(/\.exe$/, "");
}

function stripHeredocs(command) {
	const lines = command.split("\n");
	const kept = [];
	let terminator;
	for (const line of lines) {
		if (terminator !== undefined) {
			if (line.replace(/^\t+/, "") === terminator) terminator = undefined;
			continue;
		}
		kept.push(line);
		const m = line.match(/(?<![<])<<-?\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_./-]+))/);
		if (m) terminator = m[1] ?? m[2] ?? m[3];
	}
	return kept
		.join("\n")
		.replace(/\$\(\([\s\S]*?\)\)/g, "_")
		.replace(/\\\./g, "_")
		.replace(/"[^"]*"|'[^']*'/g, (quoted) => quoted.replace(/[\s<>|;&$()`#\\]/g, "_"))
		.replace(/(?:^|\s)#.*$/gm, " ");
}

function isWriteCommand(argv) {
	let i = 0;
	while (i < argv.length && (ASSIGNMENT.test(argv[i]) || SHELL_KEYWORDS.has(argv[i]))) i += 1;
	while (i < argv.length && SHELL_WRAPPERS.has(commandBasename(argv[i]))) {
		i += 1;
		while (
			i < argv.length &&
			(argv[i].startsWith("-") || argv[i] === "{}" ||
				ASSIGNMENT.test(argv[i]) || /^\d+[smhd]?$/.test(argv[i]))
		) i += 1;
	}
	if (i >= argv.length) return undefined;

	const name = commandBasename(argv[i]);
	const rest = argv.slice(i + 1);

	if (name === "tee") {
		const targets = rest.filter((a) => !a.startsWith("-"));
		return targets.some((t) => !isAllowedRedirectTarget(t)) ? "`tee`" : undefined;
	}
	if (FILE_MUTATORS.has(name)) return `\`${name}\``;

	const subcommands = WRITE_SUBCOMMANDS[name];
	if (subcommands) {
		if (name === "git" && rest.some((a) => a === "--help" || a === "-h")) return undefined;
		let k = 0;
		while (k < rest.length && rest[k].startsWith("-")) {
			k += name === "git" && /^-[cC]$/.test(rest[k]) ? 2 : 1;
		}
		const sub = rest[k]?.toLowerCase();
		if (sub && subcommands.has(sub)) {
			const next = rest[k + 1]?.toLowerCase();
			if (name === "git" && next !== undefined && GIT_READONLY_SUB[sub]?.has(next)) return undefined;
			return `\`${name} ${sub}\``;
		}
		if (name === "yarn" && rest.length === 0) return "`yarn` (install)";
		return undefined;
	}

	if (/^python[\d.]*$/.test(name)) {
		const mIdx = rest.indexOf("-m");
		const mod = mIdx === -1 ? undefined : rest[mIdx + 1]?.toLowerCase();
		if (mod === "pip" || mod === "pip3") {
			const verb = rest.slice(mIdx + 2).find((a) => !a.startsWith("-"))?.toLowerCase();
			if (verb && PIP_WRITERS.has(verb)) return `\`pip ${verb}\``;
		}
		return undefined;
	}

	const inPlace = /^-[A-Za-z]*i(\..*)?$/;
	if ((name === "sed" || name === "gsed") &&
		rest.some((a) => inPlace.test(a) || a.startsWith("--in-place"))) {
		return "`sed -i` (in-place edit)";
	}
	if (name === "perl" && rest.some((a) => inPlace.test(a))) {
		return "`perl -i` (in-place edit)";
	}
	if (/^[gnm]?awk$/.test(name)) {
		const hit = rest.some((a, idx) =>
			((a === "-i" || a === "--include") && rest[idx + 1]?.startsWith("inplace")) ||
			(a.startsWith("-i") && a.slice(2).startsWith("inplace")) ||
			a.startsWith("--include=inplace"));
		return hit ? "`awk -i inplace` (in-place edit)" : undefined;
	}
	if (name === "sort" && rest.some((a) => a.startsWith("-o") || a.startsWith("--output"))) {
		return "`sort -o` (writes a file)";
	}
	if (name === "curl") {
		const writes = rest.some((a) =>
			(!a.startsWith("--") && /^-[A-Za-z]*[oO]/.test(a)) ||
			a.startsWith("--output") || a.startsWith("--remote-name"));
		return writes ? "`curl -o` (writes a file)" : undefined;
	}
	if (name === "wget") {
		const readOnly = rest.some((a, idx) =>
			a === "--spider" || /^-[A-Za-z]*O-$/.test(a) ||
			a === "--output-document=-" || (a === "-O" && rest[idx + 1] === "-"));
		return readOnly ? undefined : "`wget` (downloads files)";
	}
	if (name === "find") {
		if (rest.includes("-delete")) return "`find -delete`";
		for (let k = 0; k < rest.length; k += 1) {
			if (!["-exec", "-execdir", "-ok", "-okdir"].includes(rest[k])) continue;
			const inner = [];
			for (let c = k + 1; c < rest.length && rest[c] !== ";" && rest[c] !== "+"; c += 1) {
				inner.push(rest[c]);
			}
			const hit = isWriteCommand(inner);
			if (hit) return hit;
		}
		return undefined;
	}
	return undefined;
}

export function detectFileMutation(command, options = {}) {
	const cwd = options.cwd;
	if (typeof command !== "string") {
		return isWriteCommand([command.command, ...(command.args ?? [])]);
	}
	const cleaned = stripHeredocs(command);
	for (const m of cleaned.matchAll(/(?:^|[^<>])(?:>{1,2}|&>{1,2})\s*([^\s;&|<>()]+)/g)) {
		if (!isAllowedRedirectTarget(m[1], cwd)) return `output redirection (\`> ${m[1]}\`)`;
	}
	for (const segment of cleaned.split(/[\n;|&()`]+/)) {
		const argv = segment.trim().split(/\s+/).filter(Boolean);
		const hit = isWriteCommand(argv);
		if (hit) return hit;
	}
	return undefined;
}

export function planModeBlockMessage(reason) {
	return `Command not executed: ${reason} can modify files, and file modifications are blocked in plan mode. ` +
		"You are in PLAN MODE — explore, analyze, and present a plan; do not make changes. " +
		"Use read-only commands to inspect the project (redirecting output to /tmp, or %TEMP% on Windows, is allowed), " +
		"and if this change is part of the task, put it in your plan so it can run after the user approves switching to act mode.";
}

export const _internal = {
	SHELL_WRAPPERS, SHELL_KEYWORDS, FILE_MUTATORS, GIT_WRITERS, PKG_WRITERS,
	WRITE_SUBCOMMANDS, isAllowedRedirectTarget, commandBasename, stripHeredocs, isWriteCommand,
};
