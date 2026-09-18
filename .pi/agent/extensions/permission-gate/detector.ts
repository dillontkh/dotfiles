import { analyzeKubectl } from "./kubectl.ts";
import { parseCommands } from "./parser.ts";
import type { OffenseViolation } from "./types.ts";

export const DANGEROUS_PATTERNS = [
	/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f?|--recursive)/i,
	/\bsudo\b/i,
	/\b(chmod|chown)\b.*777/i,
];

/**
 * Checks all decomposed commands against dangerous patterns and kubectl restrictions.
 * Returns the first violation found, or undefined if safe.
 */
export function findViolation(fullInput: string): OffenseViolation | undefined {
	const commands = parseCommands(fullInput);

	// If parser couldn't extract any commands (e.g. malformed input), fail safe by checking raw input
	if (commands.length === 0 && fullInput.trim().length > 0) {
		for (const pattern of DANGEROUS_PATTERNS) {
			if (pattern.test(fullInput)) {
				return {
					command: { argv: [fullInput], raw: fullInput, start: 0, end: fullInput.length },
					type: "dangerous-pattern",
					description: `Dangerous command detected matching ${pattern}`,
					highlightRange: { start: 0, end: fullInput.length },
				};
			}
		}
	}

	for (const cmd of commands) {
		if (cmd.argv.length === 0) continue;

		const bin = cmd.argv[0];
		const baseBin = bin.split("/").pop() || bin;

		// 1. Check rm with recursive flags (-r, -R, -rf, -fr, --recursive)
		if (baseBin === "rm") {
			const hasRecursive = cmd.argv.slice(1).some((arg) => {
				if (arg === "--recursive") return true;
				if (arg.startsWith("-") && !arg.startsWith("--") && (arg.includes("r") || arg.includes("R"))) {
					return true;
				}
				return false;
			});
			if (hasRecursive) {
				const range = cmd.parentSpan ?? { start: cmd.start, end: Math.min(cmd.end, fullInput.length) };
				return {
					command: cmd,
					type: "dangerous-pattern",
					description: `Dangerous rm command detected: ${cmd.raw}`,
					highlightRange: range,
				};
			}
		}

		// 2. Check sudo
		if (baseBin === "sudo") {
			const range = cmd.parentSpan ?? { start: cmd.start, end: Math.min(cmd.end, fullInput.length) };
			return {
				command: cmd,
				type: "dangerous-pattern",
				description: `Dangerous command detected (sudo): ${cmd.raw}`,
				highlightRange: range,
			};
		}

		// 3. Check chmod/chown with 777 or equivalent permissions
		if (baseBin === "chmod" || baseBin === "chown") {
			const hasDangerousPerm = cmd.argv.slice(1).some((arg) => {
				if (/777/.test(arg)) return true;
				// Symbolic forms like a=rwx, ugo=rwx, +rwx
				if (/([augo]*[+=][rwx]*rwx)|(\+rwx)/i.test(arg)) return true;
				return false;
			});
			if (hasDangerousPerm) {
				const range = cmd.parentSpan ?? { start: cmd.start, end: Math.min(cmd.end, fullInput.length) };
				return {
					command: cmd,
					type: "dangerous-pattern",
					description: `Dangerous command detected (777 permissions): ${cmd.raw}`,
					highlightRange: range,
				};
			}
		}

		// 4. Check kubectl commands
		const k8s = analyzeKubectl(cmd.argv);
		if (k8s.isKubectl && !k8s.isReadOnly) {
			const range = cmd.parentSpan ?? { start: cmd.start, end: Math.min(cmd.end, fullInput.length) };
			return {
				command: cmd,
				type: "non-readonly-kubectl",
				description: `Non-readonly kubectl command: ${k8s.fullVerb || k8s.subcommand || "unknown"}`,
				highlightRange: range,
			};
		}
	}

	return undefined;
}

const ANSI_RED = "\x1b[1;31m";
const ANSI_RESET = "\x1b[0m";

/**
 * Wraps the offending range in bold red ANSI escape codes, leaving the remainder unchanged.
 */
export function highlightOffense(fullInput: string, range: { start: number; end: number }): string {
	const start = Math.max(0, Math.min(range.start, fullInput.length));
	const end = Math.max(start, Math.min(range.end, fullInput.length));

	const before = fullInput.slice(0, start);
	const target = fullInput.slice(start, end);
	const after = fullInput.slice(end);

	return `${before}${ANSI_RED}${target}${ANSI_RESET}${after}`;
}
