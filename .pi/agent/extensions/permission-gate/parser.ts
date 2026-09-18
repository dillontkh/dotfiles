import type { ParsedCommand, RawToken } from "./types.ts";

/**
 * Tokenize a shell command line into words, operators, and command substitutions,
 * respecting single quotes, double quotes, escapes, ANSI-C quotes ($'...'),
 * locale quotes ($"..."), subshells, heredocs, and comments.
 */
export function tokenizeShell(input: string): RawToken[] {
	const tokens: RawToken[] = [];
	let i = 0;
	const n = input.length;

	while (i < n) {
		// Skip whitespace
		while (i < n && (input[i] === " " || input[i] === "\t" || input[i] === "\r")) {
			i++;
		}
		if (i >= n) break;

		// Comments: '#' outside quotes continues to newline
		if (input[i] === "#") {
			while (i < n && input[i] !== "\n") i++;
			continue;
		}

		// Check for 3-char operators: <<<
		if (input.slice(i, i + 3) === "<<<") {
			tokens.push({ value: "<<<", start: i, end: i + 3, isOp: true });
			i += 3;
			continue;
		}

		// Check for 2-char operators
		const op2 = input.slice(i, i + 2);
		if (op2 === "&&" || op2 === "||" || op2 === "|&" || op2 === ">>" || op2 === ">&" || op2 === "<&") {
			tokens.push({ value: op2, start: i, end: i + 2, isOp: true });
			i += 2;
			continue;
		}

		// Heredoc operator: << or <<-
		if (op2 === "<<" || op2 === "<<-") {
			tokens.push({ value: op2, start: i, end: i + 2, isOp: true });
			i += 2;

			// Skip whitespace to find the delimiter
			while (i < n && (input[i] === " " || input[i] === "\t")) i++;
			let delim = "";
			const delimStart = i;
			while (i < n && input[i] !== " " && input[i] !== "\t" && input[i] !== "\n" && input[i] !== ";") {
				delim += input[i];
				i++;
			}
			const cleanDelim = delim.replace(/['"]/g, "");
			tokens.push({ value: cleanDelim, start: delimStart, end: i, isOp: false });

			// Skip until end of current command line, then consume heredoc body until delimiter line
			while (i < n && input[i] !== "\n") i++;
			if (i < n && input[i] === "\n") i++; // newline

			while (i < n) {
				const lineStart = i;
				while (i < n && input[i] !== "\n") i++;
				const line = input.slice(lineStart, i).trim();
				if (line === cleanDelim) {
					if (i < n && input[i] === "\n") i++;
					break;
				}
				if (i < n && input[i] === "\n") i++;
			}
			continue;
		}

		const ch = input[i];
		if (ch === ";" || ch === "\n" || ch === "&" || ch === "|" || ch === "(" || ch === ")" || ch === "<" || ch === ">") {
			tokens.push({ value: ch, start: i, end: i + 1, isOp: true });
			i++;
			continue;
		}

		// Parse a word token (may contain quotes, escapes, $(), backticks, $'...', $"...")
		const tokenStart = i;
		let tokenVal = "";
		const subshells: Array<{ start: number; end: number; content: string }> = [];

		while (i < n) {
			const c = input[i];

			// Break on unquoted whitespace or control chars
			if (
				c === " " ||
				c === "\t" ||
				c === "\r" ||
				c === "\n" ||
				c === ";" ||
				c === "&" ||
				c === "|" ||
				c === "(" ||
				c === ")" ||
				c === "<" ||
				c === ">"
			) {
				break;
			}

			// ANSI-C quoting: $'...'
			if (c === "$" && i + 1 < n && input[i + 1] === "'") {
				i += 2; // skip $'
				while (i < n && input[i] !== "'") {
					if (input[i] === "\\" && i + 1 < n) {
						const next = input[i + 1];
						if (next === "n") tokenVal += "\n";
						else if (next === "t") tokenVal += "\t";
						else if (next === "r") tokenVal += "\r";
						else if (next === "'") tokenVal += "'";
						else if (next === "\\") tokenVal += "\\";
						else tokenVal += next;
						i += 2;
						continue;
					}
					tokenVal += input[i];
					i++;
				}
				if (i < n && input[i] === "'") i++; // skip closing '
				continue;
			}

			// Locale translation quoting: $"..."
			if (c === "$" && i + 1 < n && input[i + 1] === '"') {
				i += 2; // skip $"
				while (i < n && input[i] !== '"') {
					if (input[i] === "\\" && i + 1 < n) {
						tokenVal += input[i + 1];
						i += 2;
						continue;
					}
					tokenVal += input[i];
					i++;
				}
				if (i < n && input[i] === '"') i++; // skip closing "
				continue;
			}

			// Standard single quote: literal until closing single quote
			if (c === "'") {
				i++;
				while (i < n && input[i] !== "'") {
					tokenVal += input[i];
					i++;
				}
				if (i < n && input[i] === "'") i++; // skip closing '
				continue;
			}

			// Backslash escape outside single quotes
			if (c === "\\") {
				i++;
				if (i < n) {
					tokenVal += input[i];
					i++;
				}
				continue;
			}

			// Double quote: variable/command substitution active inside
			if (c === '"') {
				i++;
				while (i < n && input[i] !== '"') {
					if (input[i] === "\\" && i + 1 < n) {
						const next = input[i + 1];
						if (next === "$" || next === "`" || next === '"' || next === "\\" || next === "\n") {
							tokenVal += next;
							i += 2;
							continue;
						}
					}

					// Subshell inside double quotes: $(...)
					if (input[i] === "$" && input[i + 1] === "(") {
						const subStart = i;
						const sub = extractParenContent(input, i + 1);
						subshells.push({ start: subStart, end: sub.endIndex, content: sub.content });
						tokenVal += `$(${sub.content})`;
						i = sub.endIndex;
						continue;
					}

					// Backticks inside double quotes
					if (input[i] === "`") {
						const subStart = i;
						const sub = extractBacktickContent(input, i);
						subshells.push({ start: subStart, end: sub.endIndex, content: sub.content });
						tokenVal += `\`${sub.content}\``;
						i = sub.endIndex;
						continue;
					}

					tokenVal += input[i];
					i++;
				}
				if (i < n && input[i] === '"') i++; // skip closing "
				continue;
			}

			// Subshell outside quotes: $(...)
			if (c === "$" && i + 1 < n && input[i + 1] === "(") {
				const subStart = i;
				const sub = extractParenContent(input, i + 1);
				subshells.push({ start: subStart, end: sub.endIndex, content: sub.content });
				tokenVal += `$(${sub.content})`;
				i = sub.endIndex;
				continue;
			}

			// Backticks outside quotes
			if (c === "`") {
				const subStart = i;
				const sub = extractBacktickContent(input, i);
				subshells.push({ start: subStart, end: sub.endIndex, content: sub.content });
				tokenVal += `\`${sub.content}\``;
				i = sub.endIndex;
				continue;
			}

			tokenVal += c;
			i++;
		}

		tokens.push({
			value: tokenVal,
			start: tokenStart,
			end: i,
			isOp: false,
			hasSubshells: subshells.length > 0 ? subshells : undefined,
		});
	}

	return tokens;
}

export function extractParenContent(input: string, openParenIndex: number): { content: string; endIndex: number } {
	let depth = 1;
	let i = openParenIndex + 1;
	const n = input.length;
	let inSingle = false;
	let inDouble = false;
	const contentStart = i;

	while (i < n) {
		const c = input[i];

		if (inSingle) {
			if (c === "'") inSingle = false;
			i++;
			continue;
		}

		if (inDouble) {
			if (c === "\\" && i + 1 < n) {
				i += 2;
				continue;
			}
			if (c === '"') inDouble = false;
			i++;
			continue;
		}

		if (c === "'") {
			inSingle = true;
			i++;
			continue;
		}
		if (c === '"') {
			inDouble = true;
			i++;
			continue;
		}
		if (c === "\\") {
			i += 2;
			continue;
		}
		if (c === "(") {
			depth++;
			i++;
			continue;
		}
		if (c === ")") {
			depth--;
			if (depth === 0) {
				return { content: input.slice(contentStart, i), endIndex: i + 1 };
			}
			i++;
			continue;
		}

		i++;
	}

	return { content: input.slice(contentStart, i), endIndex: i };
}

export function extractBacktickContent(input: string, openBacktickIndex: number): { content: string; endIndex: number } {
	let i = openBacktickIndex + 1;
	const n = input.length;
	const contentStart = i;

	while (i < n) {
		if (input[i] === "\\") {
			i += 2;
			continue;
		}
		if (input[i] === "`") {
			return { content: input.slice(contentStart, i), endIndex: i + 1 };
		}
		i++;
	}

	return { content: input.slice(contentStart, i), endIndex: i };
}

const CONTROL_OPERATORS = new Set(["&&", "||", ";", "\n", "&", "|", "|&", "(", ")"]);
const SHELL_KEYWORDS = new Set([
	"if",
	"then",
	"else",
	"elif",
	"fi",
	"for",
	"while",
	"until",
	"do",
	"done",
	"case",
	"esac",
	"{",
	"}",
	"!",
]);

/**
 * Splits shell input into individual commands, recursively unwrapping subshells,
 * command substitutions, and execution wrappers.
 */
export function parseCommands(input: string, baseOffset = 0): ParsedCommand[] {
	const tokens = tokenizeShell(input);
	const commands: ParsedCommand[] = [];

	let currentTokens: RawToken[] = [];
	let cmdStart = -1;
	let cmdEnd = -1;

	// Keep track of pipeline segments to detect piped execution (e.g. echo "..." | bash)
	let previousPipelineCmd: ParsedCommand | undefined = undefined;

	function flushCommand(isPipelineBoundary: boolean) {
		if (currentTokens.length === 0) return;

		// Filter out redirections (e.g. > file, 2>&1, < file)
		const words: string[] = [];
		for (let i = 0; i < currentTokens.length; i++) {
			const tok = currentTokens[i];
			if (tok.isOp) {
				if (tok.value === "<" || tok.value === ">" || tok.value === ">>" || tok.value === ">&" || tok.value === "<&") {
					if (i + 1 < currentTokens.length && !currentTokens[i + 1].isOp) {
						i++; // skip target
					}
				}
				continue;
			}
			if (/^(\d+)?(>>?|<|>&|<&)/.test(tok.value)) {
				continue;
			}
			words.push(tok.value);
		}

		if (words.length > 0) {
			const rawSlice = input.slice(cmdStart, cmdEnd).trim();
			const simpleCmd: ParsedCommand = {
				argv: words,
				raw: rawSlice,
				start: baseOffset + cmdStart,
				end: baseOffset + cmdEnd,
			};
			commands.push(simpleCmd);

			// If current command is an interpreter receiving input from previous pipeline segment (e.g. echo "rm -rf /" | bash)
			if (previousPipelineCmd) {
				const currentBin = (words[0].split("/").pop() || words[0]).toLowerCase();
				if (currentBin === "bash" || currentBin === "sh" || currentBin === "zsh") {
					const prevBin = (previousPipelineCmd.argv[0].split("/").pop() || previousPipelineCmd.argv[0]).toLowerCase();
					if (prevBin === "echo" || prevBin === "printf") {
						const pipedContent = previousPipelineCmd.argv.slice(1).join(" ");
						const nested = parseCommands(pipedContent, previousPipelineCmd.start);
						for (const n of nested) {
							commands.push({
								...n,
								parentSpan: { start: previousPipelineCmd.start, end: simpleCmd.end },
							});
						}
					}
				}
			}

			if (isPipelineBoundary) {
				previousPipelineCmd = simpleCmd;
			} else {
				previousPipelineCmd = undefined;
			}
		}

		currentTokens = [];
		cmdStart = -1;
		cmdEnd = -1;
	}

	for (const tok of tokens) {
		// Check for subshells embedded within word tokens (e.g. $(...) or `...`)
		if (tok.hasSubshells) {
			for (const sub of tok.hasSubshells) {
				const nested = parseCommands(sub.content, baseOffset + sub.start + 2);
				commands.push(...nested);
			}
		}

		if (tok.isOp && CONTROL_OPERATORS.has(tok.value)) {
			const isPipe = tok.value === "|" || tok.value === "|&";
			flushCommand(isPipe);
			continue;
		}

		if (!tok.isOp && SHELL_KEYWORDS.has(tok.value)) {
			flushCommand(false);
			continue;
		}

		if (cmdStart === -1) cmdStart = tok.start;
		cmdEnd = tok.end;
		currentTokens.push(tok);
	}

	flushCommand(false);

	// Now unwrap wrappers (sudo, env, command, exec, sh -c, bash -c, etc.)
	const expandedCommands: ParsedCommand[] = [];

	for (const cmd of commands) {
		expandedCommands.push(...unwrapCommand(cmd));
	}

	return expandedCommands;
}

/**
 * Unwraps environment variables, sudo, nohup, command, exec, xargs, and sh/bash -c invocations.
 */
export function unwrapCommand(cmd: ParsedCommand): ParsedCommand[] {
	const results: ParsedCommand[] = [cmd];
	let argv = [...cmd.argv];

	// 1. Skip environment variable assignments before command (e.g. FOO=bar, FOO+=bar)
	let hasEnv = false;
	while (argv.length > 0 && /^[a-zA-Z_][a-zA-Z0-9_]*(\+)?=/.test(argv[0])) {
		argv.shift();
		hasEnv = true;
	}

	if (hasEnv && argv.length > 0) {
		const envStripped: ParsedCommand = {
			argv,
			raw: cmd.raw,
			start: cmd.start,
			end: cmd.end,
			parentSpan: { start: cmd.start, end: cmd.end },
		};
		results.push(envStripped);
	}

	if (argv.length === 0) return results;

	const bin = argv[0];
	const baseBin = bin.split("/").pop() || bin;

	// 2. Unwrapping command wrappers: command, exec, sudo, nohup, time, env, nice, timeout, setsid
	if (
		[
			"command",
			"exec",
			"sudo",
			"nohup",
			"time",
			"env",
			"nice",
			"timeout",
			"setsid",
			"source",
			".",
		].includes(baseBin)
	) {
		let subArgv = argv.slice(1);
		// Strip flags from wrappers
		while (subArgv.length > 0) {
			const arg = subArgv[0];
			if (arg === "--") {
				subArgv.shift();
				break;
			}
			if (arg.startsWith("-")) {
				if (["-u", "-g", "-p", "-C", "-D", "-h", "-r", "-t", "-T", "-n", "-s", "-k", "--chdir"].includes(arg)) {
					subArgv.shift();
					if (subArgv.length > 0) subArgv.shift();
				} else {
					subArgv.shift();
				}
				continue;
			}
			if (/^[a-zA-Z_][a-zA-Z0-9_]*(\+)?=/.test(arg)) {
				subArgv.shift();
				continue;
			}
			if (baseBin === "timeout" && /^\d+[smhd]?$/.test(arg)) {
				subArgv.shift();
				continue;
			}
			break;
		}

		if (subArgv.length > 0) {
			const unwrapped: ParsedCommand = {
				argv: subArgv,
				raw: cmd.raw,
				start: cmd.start,
				end: cmd.end,
				parentSpan: { start: cmd.start, end: cmd.end },
			};
			results.push(unwrapped);
			results.push(...unwrapCommand(unwrapped));
		}
	}

	// 3. Unwrapping xargs (e.g. xargs -I {} rm -rf {})
	if (baseBin === "xargs") {
		let subArgv = argv.slice(1);
		while (subArgv.length > 0 && subArgv[0].startsWith("-")) {
			const opt = subArgv.shift()!;
			if (["-I", "-n", "-s", "-P", "-d", "-E", "-L", "-a"].includes(opt) && subArgv.length > 0) {
				subArgv.shift();
			}
		}
		if (subArgv.length > 0) {
			const unwrapped: ParsedCommand = {
				argv: subArgv,
				raw: cmd.raw,
				start: cmd.start,
				end: cmd.end,
				parentSpan: { start: cmd.start, end: cmd.end },
			};
			results.push(unwrapped);
			results.push(...unwrapCommand(unwrapped));
		}
	}

	// 4. Unwrapping shell -c: sh -c "...", bash -ec "...", zsh -c "...", eval "..."
	if (["sh", "bash", "zsh", "eval"].includes(baseBin)) {
		for (let i = 1; i < argv.length; i++) {
			if (/^-[a-zA-Z]*c$/.test(argv[i]) && i + 1 < argv.length) {
				const nestedStr = argv[i + 1];
				const rawIndex = cmd.raw.indexOf(nestedStr);
				const nestedOffset = rawIndex >= 0 ? cmd.start + rawIndex : cmd.start;
				const nestedCmds = parseCommands(nestedStr, nestedOffset);
				for (const nc of nestedCmds) {
					results.push({
						...nc,
						parentSpan: { start: cmd.start, end: cmd.end },
					});
				}
				break;
			}
		}
		if (baseBin === "eval" && argv.length > 1) {
			const nestedStr = argv.slice(1).join(" ");
			const rawIndex = cmd.raw.indexOf(nestedStr);
			const nestedOffset = rawIndex >= 0 ? cmd.start + rawIndex : cmd.start;
			const nestedCmds = parseCommands(nestedStr, nestedOffset);
			for (const nc of nestedCmds) {
				results.push({
					...nc,
					parentSpan: { start: cmd.start, end: cmd.end },
				});
			}
		}
	}

	return results;
}
