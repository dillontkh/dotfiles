import { homedir } from "os";
import type {
	AgentToolResult,
	EditToolDetails,
	ExtensionAPI,
	Theme,
	ToolDefinition,
	ToolRenderContext,
	ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

// =============================================================================
// Pure Helpers
// =============================================================================

function shortenPath(filePath?: string): string {
	if (!filePath) return "";
	const home = homedir();
	if (filePath === home) return "~";
	if (filePath.startsWith(`${home}/`)) return `~${filePath.slice(home.length)}`;
	return filePath;
}

function truncate(str: string, max: number): string {
	return str.length > max ? `${str.slice(0, max - 3)}...` : str;
}

function getText(result: AgentToolResult<unknown>): string {
	const content = result.content?.[0];
	return content?.type === "text" ? content.text.trim() : "";
}

function countLines(text: string): number {
	return text ? text.split("\n").length : 0;
}

function previewLines(text: string, max: number, theme: Theme): string | undefined {
	if (!text) return undefined;
	const lines = text.split("\n");
	const shown = lines.slice(0, max).map((line) => theme.fg("toolOutput", line));
	if (lines.length > max) {
		shown.push(theme.fg("muted", `... (${lines.length - max} more lines)`));
	}
	return shown.join("\n");
}

function getDiffStats(diff?: string): { adds: number; dels: number } {
	let adds = 0;
	let dels = 0;
	if (!diff) return { adds, dels };
	for (const line of diff.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) adds++;
		if (line.startsWith("-") && !line.startsWith("---")) dels++;
	}
	return { adds, dels };
}

function formatDiffPreview(diff: string, theme: Theme, maxLines = 30): string {
	const lines = diff.split("\n");
	const preview = lines.slice(0, maxLines).map((line) => {
		if (line.startsWith("+") && !line.startsWith("+++")) return theme.fg("toolDiffAdded", line);
		if (line.startsWith("-") && !line.startsWith("---")) return theme.fg("toolDiffRemoved", line);
		return theme.fg("toolDiffContext", line);
	});
	if (lines.length > maxLines) {
		preview.push(theme.fg("muted", `... (${lines.length - maxLines} more diff lines)`));
	}
	return preview.join("\n");
}

function getGlobalTheme(): Theme | undefined {
	return (
		(globalThis as Record<symbol, unknown>)[Symbol.for("@earendil-works/pi-coding-agent:theme")] ??
		(globalThis as Record<symbol, unknown>)[Symbol.for("@mariozechner/pi-coding-agent:theme")]
	) as Theme | undefined;
}

// =============================================================================
// Compact Tool Renderer Factory
// =============================================================================

interface CompactRendererConfig<TArgs, TDetails> {
	call: (args: TArgs, theme: Theme) => string;
	summary: (result: AgentToolResult<TDetails>, theme: Theme, args: TArgs) => string;
	preview?: (result: AgentToolResult<TDetails>, theme: Theme) => string | undefined;
}

function createCompactRenderers<TArgs, TDetails>(config: CompactRendererConfig<TArgs, TDetails>) {
	return {
		renderCall(args: TArgs, theme: Theme) {
			return new Text(config.call(args, theme), 0, 0);
		},
		renderResult(
			result: AgentToolResult<TDetails>,
			options: ToolRenderResultOptions,
			theme: Theme,
			context: ToolRenderContext<unknown, TArgs>,
		) {
			if (options.isPartial) return new Text(theme.fg("warning", " ..."), 0, 0);

			const summary = config.summary(result, theme, context.args);
			if (!options.expanded) return new Text(summary, 0, 0);

			const body = config.preview?.(result, theme);
			return new Text(body ? `${summary}\n${body}` : summary, 0, 0);
		},
	};
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function (pi: ExtensionAPI) {
	const cwd = process.cwd();

	function register<TDef extends ToolDefinition<any, any, any>>(
		factory: (cwd: string) => TDef,
		config: CompactRendererConfig<any, any>,
		overrides?: Partial<ToolDefinition<any, any, any>>,
	) {
		try {
			const def = factory(cwd);
			pi.registerTool({
				...def,
				...createCompactRenderers(config),
				...overrides,
			});
		} catch {
			// Factory unavailable in current environment
		}
	}

	// ---------------------------------------------------------------------------
	// 1. Built-in Tools: Explicit Compact Renderers
	// ---------------------------------------------------------------------------

	// Bash: $ <cmd> → ✓ done (N lines) / ✗ exit <code>
	register(createBashToolDefinition, {
		call: (args, theme) => {
			const cmd = truncate(args.command?.trim() || "", 80);
			return `${theme.fg("toolTitle", theme.bold("$ "))}${theme.fg("accent", cmd)}`;
		},
		summary: (res, theme) => {
			const text = getText(res);
			const exitCode = text.match(/exit code: (\d+)/i)?.[1];
			const isError = res.isError || (exitCode !== undefined && exitCode !== "0");
			const status = isError
				? theme.fg("error", `✗ ${exitCode ? `exit ${exitCode}` : "failed"}`)
				: theme.fg("success", "✓ done");
			const count = text ? theme.fg("dim", ` (${countLines(text)} lines)`) : "";
			return `${status}${count}`;
		},
		preview: (res, theme) => previewLines(getText(res), 100, theme),
	});

	// Read: read <path>[:lines] → → N lines / ✓ image loaded
	register(createReadToolDefinition, {
		call: (args, theme) => {
			let path = `${theme.fg("toolTitle", theme.bold("read "))}${theme.fg("accent", shortenPath(args.path))}`;
			if (args.offset !== undefined || args.limit !== undefined) {
				const start = args.offset ?? 1;
				const end = args.limit !== undefined ? start + args.limit - 1 : "";
				path += theme.fg("dim", `:${start}${end ? `-${end}` : ""}`);
			}
			return path;
		},
		summary: (res, theme) => {
			if (res.content?.[0]?.type === "image") return theme.fg("success", "✓ image loaded");
			if (res.isError) return theme.fg("error", "✗ failed");
			return theme.fg("dim", `→ ${countLines(getText(res))} lines`);
		},
		preview: (res, theme) => previewLines(getText(res), 30, theme),
	});

	// Edit: edit <path> → +X -Y
	register(
		createEditToolDefinition,
		{
			call: (args, theme) =>
				`${theme.fg("toolTitle", theme.bold("edit "))}${theme.fg("accent", shortenPath(args.path))}`,
			summary: (res, theme) => {
				if (res.isError) return theme.fg("error", `✗ ${getText(res).split("\n")[0] || "failed"}`);
				const details = res.details as EditToolDetails | undefined;
				if (!details?.diff) return theme.fg("success", "✓ applied");
				const { adds, dels } = getDiffStats(details.diff);
				return `${theme.fg("success", `+${adds}`)} ${theme.fg("error", `-${dels}`)}`;
			},
			preview: (res, theme) => {
				const diff = (res.details as EditToolDetails | undefined)?.diff;
				return diff ? formatDiffPreview(diff, theme) : undefined;
			},
		},
		{ renderShell: "default" },
	);

	// Write: write <path> (N lines) → ✓ written
	register(createWriteToolDefinition, {
		call: (args, theme) => {
			const lines = countLines(args.content || "");
			return `${theme.fg("toolTitle", theme.bold("write "))}${theme.fg("accent", shortenPath(args.path))}${theme.fg("dim", ` (${lines} lines)`)}`;
		},
		summary: (res, theme) => {
			if (res.isError) return theme.fg("error", `✗ ${getText(res).split("\n")[0] || "failed"}`);
			return theme.fg("success", "✓ written");
		},
	});

	// Grep, Find, Ls: <tool> <pattern|path> → → N items
	const inspectTools = [
		{ name: "grep", factory: createGrepToolDefinition, label: "matches" },
		{ name: "find", factory: createFindToolDefinition, label: "files" },
		{ name: "ls", factory: createLsToolDefinition, label: "entries" },
	] as const;

	for (const { name, factory, label } of inspectTools) {
		register(factory, {
			call: (args, theme) => {
				const target = args.pattern || shortenPath(args.path);
				return `${theme.fg("toolTitle", theme.bold(name + " "))}${theme.fg("accent", target)}`;
			},
			summary: (res, theme) => {
				if (res.isError) return theme.fg("error", "✗ failed");
				return theme.fg("dim", `→ ${countLines(getText(res))} ${label}`);
			},
			preview: (res, theme) => previewLines(getText(res), 25, theme),
		});
	}

	// ---------------------------------------------------------------------------
	// 2. 3rd-Party & Custom Tool Fallback Hook
	// ---------------------------------------------------------------------------
	if (ToolExecutionComponent?.prototype) {
		const proto = ToolExecutionComponent.prototype as any;
		const origResultFallback = proto.createResultFallback;
		const origCallFallback = proto.createCallFallback;

		// 1-line collapsed result for any 3rd-party tool without a custom renderer
		proto.createResultFallback = function () {
			const output = this.getTextOutput();
			if (!output) return undefined;

			if (!this.expanded) {
				const theme = getGlobalTheme();
				const text = output.trim();
				const lines = text ? text.split("\n") : [];
				const isError = this.result?.isError ?? false;

				const status = theme
					? (isError ? theme.fg("error", "✗ failed") : theme.fg("success", "✓ done"))
					: (isError ? "✗ failed" : "✓ done");

				const detail =
					lines.length === 1 && lines[0].length <= 50 && !isError
						? lines[0]
						: lines.length > 0 ? `${lines.length} lines` : "";
				const count = detail ? (theme ? theme.fg("dim", ` (${detail})`) : ` (${detail})`) : "";

				return new Text(`${status}${count}`, 0, 0);
			}

			return origResultFallback?.call(this);
		};

		// 1-line call title with primary argument for any 3rd-party tool
		proto.createCallFallback = function () {
			const theme = getGlobalTheme();
			let title = theme ? theme.fg("toolTitle", theme.bold(this.toolName)) : this.toolName;

			if (this.args && typeof this.args === "object") {
				const primary =
					this.args.prompt ??
					this.args.query ??
					this.args.path ??
					this.args.command ??
					this.args.url ??
					this.args.name;

				if (typeof primary === "string" && primary.trim()) {
					const display = truncate(primary.trim(), 70);
					title += theme ? ` ${theme.fg("accent", display)}` : ` ${display}`;
				}
			}

			return new Text(title, 0, 0);
		};
	}

	// ---------------------------------------------------------------------------
	// 3. Markdown: Collapse multi-line gaps and loose list spacing
	// ---------------------------------------------------------------------------
	pi.registerMarkdownTransformer((md) =>
		md
			.replace(/\n{3,}/g, "\n\n")
			.trim()
			.replace(/^(\s*[-*+\d.]+\s+[^\n]+)\n\n+(?=\s*[-*+\d.]+\s+)/gm, "$1\n"),
	);
}
