import type { KubectlAnalysis } from "./types.ts";

/**
 * Standard readonly kubectl subcommands allowlist.
 */
export const KUBECTL_READONLY_COMMANDS = new Set([
	"get",
	"describe",
	"logs",
	"log",
	"explain",
	"top",
	"version",
	"cluster-info",
	"api-resources",
	"api-versions",
	"diff",
]);

/**
 * Global flags that take a single separate argument in kubectl.
 */
export const KUBECTL_GLOBAL_FLAGS_WITH_ARG = new Set([
	"--kubeconfig",
	"--namespace",
	"-n",
	"--context",
	"--cluster",
	"--user",
	"-s",
	"--server",
	"--as",
	"--as-group",
	"--as-uid",
	"--certificate-authority",
	"--client-certificate",
	"--client-key",
	"--token",
	"--request-timeout",
	"-v",
	"--v",
	"--cache-dir",
	"--username",
	"--password",
	"--tls-server-name",
	"--vmodule",
	"--profile",
	"--profile-output",
]);

/**
 * Inspects a command's argv to determine if it is a kubectl command and whether
 * it is read-only.
 */
export function analyzeKubectl(argv: string[]): KubectlAnalysis {
	if (argv.length === 0) return { isKubectl: false, isReadOnly: true };

	const bin = argv[0].split("/").pop() || argv[0];
	if (bin !== "kubectl" && bin !== "k") {
		return { isKubectl: false, isReadOnly: true };
	}

	// Skip global flags to locate the kubectl verb / subcommand
	let i = 1;
	while (i < argv.length) {
		const arg = argv[i];

		if (arg === "--") {
			i++;
			break;
		}

		if (arg.startsWith("-")) {
			// Check if flag includes '=' (e.g. -n=prod or --namespace=prod)
			if (arg.includes("=")) {
				i++;
				continue;
			}
			// Check if flag takes a separate value
			if (KUBECTL_GLOBAL_FLAGS_WITH_ARG.has(arg)) {
				i += 2;
				continue;
			}
			// Boolean or other flag
			i++;
			continue;
		}

		// First non-flag token is the subcommand
		break;
	}

	if (i >= argv.length) {
		// Bare 'kubectl' or 'kubectl --help'
		return { isKubectl: true, isReadOnly: true };
	}

	const sub = argv[i].toLowerCase();

	// Help is always read-only
	if (sub === "help") {
		return { isKubectl: true, isReadOnly: true, subcommand: sub };
	}

	// Read-only subcommands
	if (KUBECTL_READONLY_COMMANDS.has(sub)) {
		return { isKubectl: true, isReadOnly: true, subcommand: sub, fullVerb: sub };
	}

	// Special handling for 'auth': 'auth can-i' is read-only
	if (sub === "auth") {
		const next = argv[i + 1]?.toLowerCase();
		if (next === "can-i") {
			return { isKubectl: true, isReadOnly: true, subcommand: sub, fullVerb: "auth can-i" };
		}
		return { isKubectl: true, isReadOnly: false, subcommand: sub, fullVerb: `auth ${next || ""}`.trim() };
	}

	// Special handling for 'config': only view and get-* are read-only
	if (sub === "config") {
		const next = argv[i + 1]?.toLowerCase();
		const readonlyConfig = ["view", "get-contexts", "current-context", "get-clusters", "get-users"];
		if (next && readonlyConfig.includes(next)) {
			return { isKubectl: true, isReadOnly: true, subcommand: sub, fullVerb: `config ${next}` };
		}
		return { isKubectl: true, isReadOnly: false, subcommand: sub, fullVerb: `config ${next || ""}`.trim() };
	}

	// Any other subcommand (e.g. delete, apply, create, patch, edit, scale, exec, run, cp)
	return { isKubectl: true, isReadOnly: false, subcommand: sub, fullVerb: sub };
}
