window.__ModuleLoader__.load({
	id: "dsh-cline",
	factory: (require) => {
		const react = require("react");
		const h = react.createElement;
		const module = { exports: {} };
		const exports = module.exports;

		exports.name = "dsh-cline-client";
		exports.inject = ["slots"];

		const ROW_KEY = "dsh-cline#dsh-cline";
		const LABEL = { fontSize: "12px", color: "var(--dsh-text-secondary, #888)", marginBottom: "4px", display: "block" };
		const INPUT = { width: "100%", padding: "6px 8px", fontSize: "13px", boxSizing: "border-box" };
		const NOTE = { fontSize: "12px", color: "var(--dsh-text-secondary, #888)", margin: "0 0 12px" };
		const FIELD = { marginBottom: "12px" };
		const MODEL_LIST_ID = "dsh-cline-model-choices";
		const FREE_MODEL_CHOICES = [
			{ id: "cline-free/nemotron-3.5-super-vl", label: "Nemotron 3.5 Super VL · 120B · 200k 上下文（默认）" },
			{ id: "nvidia/nemotron-3.5-lightning-free", label: "Nemotron 3.5 Lightning · 200k 上下文" },
			{ id: "reflection/beam-free", label: "Beam · 200k 上下文" },
			{ id: "cline-free/solar-mini4", label: "Solar Mini 4 · 35B MoE · 200k 上下文" },
		];

		function read(value, secrets) {
			const raw = value ?? {};
			const stored = (secrets ?? []).some((entry) => Array.isArray(entry?.path) && entry.path.join(".") === "apiKey" && entry.set);
			return {
				apiKey: "",
				hasKey: stored || (typeof raw.apiKey === "string" && raw.apiKey.length > 0),
				baseURL: typeof raw.baseURL === "string" ? raw.baseURL : "https://api.cline.bot/api/v1",
				model: typeof raw.model === "string" ? raw.model : "cline-free/nemotron-3.5-super-vl",
				defaultCwd: typeof raw.defaultCwd === "string" ? raw.defaultCwd : "",
				maxIterations: Number.isInteger(raw.maxIterations) && raw.maxIterations > 0 ? String(raw.maxIterations) : "",
				enableProvider: raw.enableProvider !== false,
				enableTool: raw.enableTool !== false,
			};
		}

		function useEditor(form) {
			const snap = () => read(form?.state?.value, form?.state?.secrets);
			const [draft, setDraft] = react.useState(snap);
			const [dirty, setDirty] = react.useState(false);
			const [busy, setBusy] = react.useState(false);
			const [message, setMessage] = react.useState("");
			const revision = form?.state?.revision;
			const ready = form?.state?.status === "ready" && form.state.writable === true;
			react.useEffect(() => {
				if (!dirty) setDraft(snap());
			}, [form?.state?.revision, form?.state?.status, dirty]);
			const edit = (patch) => {
				setDraft((prev) => ({ ...prev, ...patch }));
				setDirty(true);
				setMessage("");
			};
			const reset = () => {
				setDraft(snap());
				setDirty(false);
				setMessage("");
			};
			const save = async (operations) => {
				if (!ready || busy || revision === undefined) return;
				setBusy(true);
				setMessage("");
				try {
					const accepted = await form.mutate(operations, revision);
					setMessage(accepted ? "已保存" : "保存被拒绝（配置已变化，请重试）");
					if (accepted) setDirty(false);
				} catch (error) {
					setMessage(String(error?.message ?? error));
				} finally {
					setBusy(false);
				}
			};
			return { draft, edit, dirty, busy, ready, message, reset, save };
		}

		function row(label, input) {
			return h("div", { style: FIELD, key: label }, h("label", { style: LABEL }, label), input);
		}

		function textInput(value, onChange, props) {
			return h("input", { type: "text", style: INPUT, value, onChange: (event) => onChange(event.target.value), ...props });
		}

		function check(label, checked, onChange, disabled) {
			return h("label", { style: { display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px", fontSize: "13px" } },
				h("input", { type: "checkbox", checked, disabled, onChange: (event) => onChange(event.target.checked) }),
				label);
		}

		function KeyForm(props) {
			const { form } = props;
			const editor = useEditor(form);
			if (!editor.ready) {
				const status = form === undefined ? undefined : form?.state?.status;
				const note = status === "loading" || (form !== undefined && status === undefined)
					? "正在加载配置…"
					: status === "unavailable"
						? "该配置命名空间当前不可用（可能已停载）。稍后重试，或重启 DSH。"
						: "这个 DSH 版本没有为该行提供可写配置表单。直接编辑文件同样有效：";
				const showFileHint = form !== undefined && status !== "loading" && status !== "unavailable"
					|| form === undefined;
				return h("div", null,
					h("p", { style: NOTE }, note),
					showFileHint
						? h("code", null, "%DSH_HOME%\\cline.json → {\"apiKey\":\"<your key>\"}")
						: null);
			}
			const { draft, edit, busy } = editor;
			const submit = (event) => {
				event.preventDefault();
				const operations = [
					draft.apiKey.trim() ? { op: "set", path: ["apiKey"], value: draft.apiKey.trim() } : null,
					{ op: "set", path: ["baseURL"], value: draft.baseURL.trim() || "https://api.cline.bot/api/v1" },
					{ op: "set", path: ["model"], value: draft.model.trim() || "cline-free/nemotron-3.5-super-vl" },
					draft.defaultCwd.trim() ? { op: "set", path: ["defaultCwd"], value: draft.defaultCwd.trim() } : { op: "unset", path: ["defaultCwd"] },
					draft.maxIterations ? { op: "set", path: ["maxIterations"], value: Number(draft.maxIterations) } : { op: "unset", path: ["maxIterations"] },
					{ op: "set", path: ["enableProvider"], value: draft.enableProvider },
					{ op: "set", path: ["enableTool"], value: draft.enableTool },
				].filter(Boolean);
				void editor.save(operations);
			};
			return h("form", { onSubmit: submit },
				h("p", { style: NOTE }, editor.draft.hasKey
					? "已保存过密钥（出于安全不回显）。留空保存 = 保留原密钥。"
					: "填入 Cline API Key。保存后写入本行配置，优先级高于 cline.json。"),
				row("Cline API Key",
					h("input", {
						type: "password",
						style: INPUT,
						value: draft.apiKey,
						autoComplete: "off",
						placeholder: draft.hasKey ? "已保存，留空则不变" : "sk_...",
						onChange: (event) => edit({ apiKey: event.target.value }),
					})),
				row("模型（免费池）", textInput(draft.model, (model) => edit({ model }), { placeholder: "cline-free/nemotron-3.5-super-vl", list: MODEL_LIST_ID })),
				row("网关地址", textInput(draft.baseURL, (baseURL) => edit({ baseURL }), { placeholder: "https://api.cline.bot/api/v1" })),
				row("默认工作目录（可空）", textInput(draft.defaultCwd, (defaultCwd) => edit({ defaultCwd }), { placeholder: "cline 工具执行任务的目录" })),
				row("最大迭代数（可空）", textInput(draft.maxIterations, (maxIterations) => edit({ maxIterations: maxIterations.replace(/[^0-9]/g, "") }), { inputMode: "numeric" })),
				check("注册为模型供应商（cline）", draft.enableProvider, (enableProvider) => edit({ enableProvider }), busy),
				check("注册 cline 委派工具", draft.enableTool, (enableTool) => edit({ enableTool }), busy),
				h("div", { style: { display: "flex", gap: "8px", marginTop: "12px" } },
					h("button", { type: "submit", disabled: busy || !editor.dirty }, busy ? "保存中…" : "保存"),
					h("button", { type: "button", onClick: editor.reset, disabled: busy }, "重置")),
				editor.message ? h("p", { role: "status", style: NOTE }, editor.message) : null,
				h("datalist", { id: MODEL_LIST_ID },
					FREE_MODEL_CHOICES.map((choice) => h("option", { key: choice.id, value: choice.id, label: choice.label }))));
		}

		exports.apply = function apply(ctx) {
			ctx.slots.inject("plugins.row.config", function* () {
				yield ctx.slots.register(
					{ name: "plugins.row.config", key: ROW_KEY },
					(props) => props.view === "summary"
						? h("span", null, "Cline API Key、模型与工具开关")
						: h(KeyForm, props),
				);
			});
		};

		return module.exports;
	},
});