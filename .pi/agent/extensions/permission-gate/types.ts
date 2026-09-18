export interface ParsedCommand {
	/** Unwrapped argv tokens with quotes stripped for interpretation */
	argv: string[];
	/** Raw text slice of this simple command in the source string */
	raw: string;
	/** Start index in original top-level command string */
	start: number;
	/** End index in original top-level command string */
	end: number;
	/** If this command was unwrapped or nested (e.g. inside $(...), bash -c, sudo) */
	parentSpan?: { start: number; end: number };
}

export interface RawToken {
	value: string;
	start: number;
	end: number;
	isOp: boolean;
	hasSubshells?: Array<{ start: number; end: number; content: string }>;
}

export interface KubectlAnalysis {
	isKubectl: boolean;
	isReadOnly: boolean;
	subcommand?: string;
	fullVerb?: string;
}

export interface OffenseViolation {
	command: ParsedCommand;
	type: "dangerous-pattern" | "non-readonly-kubectl";
	description: string;
	highlightRange: { start: number; end: number };
}
