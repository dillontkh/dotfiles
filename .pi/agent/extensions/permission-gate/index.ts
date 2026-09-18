/**
 * Permission Gate Extension (Enhanced)
 *
 * Prompts for confirmation before running potentially dangerous bash commands
 * or non-readonly kubectl commands. Supports chained commands (&, ;, &&, ||, |, \n),
 * subshells, command wrappers, and highlights the offending segment in red.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { findViolation, highlightOffense } from "./detector.ts";

export * from "./types.ts";
export * from "./parser.ts";
export * from "./kubectl.ts";
export * from "./detector.ts";

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		const command = (event.input as { command?: string }).command || "";
		const violation = findViolation(command);

		if (violation) {
			if (!ctx.hasUI) {
				return {
					block: true,
					reason: "Dangerous command blocked (no UI for confirmation)",
				};
			}

			const highlighted = highlightOffense(command, violation.highlightRange);
			const choice = await ctx.ui.select(`⚠️ Dangerous command:\n\n  ${highlighted}\n\nAllow?`, ["Yes", "No"]);

			if (choice !== "Yes") {
				return { block: true, reason: "Blocked by user" };
			}
		}

		return undefined;
	});
}
