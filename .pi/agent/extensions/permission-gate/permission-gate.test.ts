import {
	analyzeKubectl,
	findViolation,
	highlightOffense,
	parseCommands,
	tokenizeShell,
} from "./index.ts";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
	if (condition) {
		passed++;
	} else {
		failed++;
		console.error(`❌ FAIL: ${message}`);
	}
}

console.log("=== Running Permission Gate Test Suite ===");

// ---------------------------------------------------------------------------
// 1. Shell Tokenizer & Command Splitting Tests
// ---------------------------------------------------------------------------
console.log("\n--- 1. Tokenizer & Command Splitting ---");

{
	const cmd = "echo hello && rm -rf /tmp/test";
	const parsed = parseCommands(cmd);
	assert(parsed.length === 2, `Should split into 2 commands, got ${parsed.length}`);
	assert(parsed[0].argv.join(" ") === "echo hello", `First command should be 'echo hello'`);
	assert(parsed[1].argv.join(" ") === "rm -rf /tmp/test", `Second command should be 'rm -rf /tmp/test'`);
}

{
	const cmd = "kubectl get pods; kubectl delete pod foo";
	const parsed = parseCommands(cmd);
	assert(parsed.length === 2, `Should split into 2 commands, got ${parsed.length}`);
	assert(parsed[0].argv.join(" ") === "kubectl get pods", `First command matches`);
	assert(parsed[1].argv.join(" ") === "kubectl delete pod foo", `Second command matches`);
}

{
	const cmd = "cat manifest.yaml | grep service | kubectl apply -f -";
	const parsed = parseCommands(cmd);
	assert(parsed.length === 3, `Should split pipeline into 3 commands, got ${parsed.length}`);
	assert(parsed[2].argv[0] === "kubectl", `Third pipeline command is kubectl`);
	assert(parsed[2].argv[1] === "apply", `Third pipeline verb is apply`);
}

{
	const cmd = "echo 'hello && rm -rf /; sudo reboot'";
	const parsed = parseCommands(cmd);
	assert(parsed.length === 1, `Single quotes should prevent splitting, got ${parsed.length}`);
	assert(parsed[0].argv[0] === "echo", `Command is echo`);
}

{
	const cmd = 'echo "hello; rm -rf /; sudo reboot"';
	const parsed = parseCommands(cmd);
	assert(parsed.length === 1, `Double quotes should prevent operator splitting, got ${parsed.length}`);
	assert(parsed[0].argv[0] === "echo", `Command is echo`);
}

{
	const cmd = "echo $(kubectl delete pod bar)";
	const parsed = parseCommands(cmd);
	const hasNested = parsed.some((c) => c.argv.join(" ") === "kubectl delete pod bar");
	assert(hasNested, `Subshell $(...) command should be extracted`);
}

{
	const cmd = "echo `rm -rf /tmp/data`";
	const parsed = parseCommands(cmd);
	const hasNested = parsed.some((c) => c.argv.join(" ") === "rm -rf /tmp/data");
	assert(hasNested, `Backtick command substitution should be extracted`);
}

{
	const cmd = "bash -c 'kubectl delete pod test'";
	const parsed = parseCommands(cmd);
	const hasNested = parsed.some((c) => c.argv[0] === "kubectl" && c.argv[1] === "delete");
	assert(hasNested, `bash -c nested command should be extracted`);
}

{
	const cmd = "sudo kubectl delete pod test";
	const parsed = parseCommands(cmd);
	const hasNested = parsed.some((c) => c.argv[0] === "kubectl" && c.argv[1] === "delete");
	assert(hasNested, `sudo wrapper should unwrap target command`);
}

{
	const cmd = "KUBECONFIG=/tmp/kube.conf kubectl delete pod test";
	const parsed = parseCommands(cmd);
	const hasNested = parsed.some((c) => c.argv[0] === "kubectl" && c.argv[1] === "delete");
	assert(hasNested, `Environment variable prefix should be unwrapped`);
}

// ---------------------------------------------------------------------------
// 2. Kubectl Readonly vs Non-Readonly Analysis Tests
// ---------------------------------------------------------------------------
console.log("\n--- 2. Kubectl Readonly Analysis ---");

const readonlyKubectlCases = [
	["kubectl", "get", "pods"],
	["k", "get", "nodes", "-o", "wide"],
	["kubectl", "describe", "pod", "web-1"],
	["kubectl", "logs", "-f", "web-1"],
	["kubectl", "log", "web-1"],
	["kubectl", "explain", "pod.spec"],
	["kubectl", "top", "pods"],
	["kubectl", "top", "nodes"],
	["kubectl", "version", "--client"],
	["kubectl", "cluster-info"],
	["kubectl", "api-resources"],
	["kubectl", "api-versions"],
	["kubectl", "diff", "-f", "manifest.yaml"],
	["kubectl", "auth", "can-i", "create", "deployments"],
	["kubectl", "config", "view"],
	["kubectl", "config", "get-contexts"],
	["kubectl", "config", "current-context"],
	["kubectl", "-n", "prod", "get", "services"],
	["kubectl", "--namespace=production", "describe", "svc", "web"],
	["kubectl", "--context", "minikube", "-v=6", "get", "pods"],
	["k", "-n", "kube-system", "logs", "coredns"],
];

for (const c of readonlyKubectlCases) {
	const res = analyzeKubectl(c);
	assert(res.isKubectl && res.isReadOnly, `Expected readonly for: ${c.join(" ")}`);
}

const nonReadonlyKubectlCases = [
	["kubectl", "delete", "pod", "test"],
	["k", "delete", "ns", "dev"],
	["kubectl", "apply", "-f", "manifest.yaml"],
	["kubectl", "create", "deployment", "web", "--image=nginx"],
	["kubectl", "patch", "deployment", "web", "-p", "{}"],
	["kubectl", "replace", "-f", "pod.yaml"],
	["kubectl", "edit", "configmap", "settings"],
	["kubectl", "scale", "deployment", "web", "--replicas=3"],
	["kubectl", "autoscale", "deployment", "web", "--min=2", "--max=5"],
	["kubectl", "exec", "-it", "web-1", "--", "bash"],
	["kubectl", "attach", "web-1"],
	["kubectl", "cp", "local.txt", "pod:/tmp/"],
	["kubectl", "port-forward", "svc/web", "8080:80"],
	["kubectl", "proxy"],
	["kubectl", "run", "debug", "--image=busybox"],
	["kubectl", "label", "pod", "web-1", "env=prod"],
	["kubectl", "annotate", "pod", "web-1", "description=test"],
	["kubectl", "cordon", "node-1"],
	["kubectl", "drain", "node-1"],
	["kubectl", "taint", "nodes", "node-1", "key=value:NoSchedule"],
	["kubectl", "set", "image", "deployment/web", "nginx=nginx:1.21"],
	["kubectl", "rollout", "restart", "deployment/web"],
	["kubectl", "rollout", "undo", "deployment/web"],
	["kubectl", "config", "use-context", "prod"],
	["kubectl", "config", "set-context", "prod", "--cluster=c1"],
	["kubectl", "auth", "reconcile", "-f", "rbac.yaml"],
];

for (const c of nonReadonlyKubectlCases) {
	const res = analyzeKubectl(c);
	assert(res.isKubectl && !res.isReadOnly, `Expected non-readonly (blocked) for: ${c.join(" ")}`);
}

// ---------------------------------------------------------------------------
// 3. Violation Detection & Chaining Tests
// ---------------------------------------------------------------------------
console.log("\n--- 3. Violation Detection ---");

const violationCases = [
	{ cmd: "rm -rf /tmp/foo", expectedType: "dangerous-pattern" },
	{ cmd: "rm -r /tmp/foo", expectedType: "dangerous-pattern" },
	{ cmd: "rm -fr /tmp/foo", expectedType: "dangerous-pattern" },
	{ cmd: "rm --recursive /tmp/foo", expectedType: "dangerous-pattern" },
	{ cmd: "sudo reboot", expectedType: "dangerous-pattern" },
	{ cmd: "chmod 777 script.sh", expectedType: "dangerous-pattern" },
	{ cmd: "chown -R 777 /var/www", expectedType: "dangerous-pattern" },
	{ cmd: "kubectl delete pod foo", expectedType: "non-readonly-kubectl" },
	{ cmd: "k apply -f manifest.yaml", expectedType: "non-readonly-kubectl" },
	// Chained commands
	{ cmd: "echo ok && rm -rf /", expectedType: "dangerous-pattern" },
	{ cmd: "ls -la; sudo apt-get update", expectedType: "dangerous-pattern" },
	{ cmd: "true || chmod 777 /file", expectedType: "dangerous-pattern" },
	{ cmd: "kubectl get pods && kubectl delete pod bad", expectedType: "non-readonly-kubectl" },
	{ cmd: "cat app.yaml | kubectl apply -f -", expectedType: "non-readonly-kubectl" },
	{ cmd: "k get nodes; k scale deploy/web --replicas=0", expectedType: "non-readonly-kubectl" },
	{ cmd: "sh -c 'kubectl delete pod x'", expectedType: "non-readonly-kubectl" },
	{ cmd: "bash -c 'sudo rm -rf /'", expectedType: "dangerous-pattern" },
	{ cmd: "echo $(kubectl delete pod x)", expectedType: "non-readonly-kubectl" },
	{ cmd: "echo `sudo rm -rf /`", expectedType: "dangerous-pattern" },
	// Adversarial audit cases
	{ cmd: "$'rm' -rf /", expectedType: "dangerous-pattern" },
	{ cmd: "rm $'-rf' /", expectedType: "dangerous-pattern" },
	{ cmd: "$'sudo' whoami", expectedType: "dangerous-pattern" },
	{ cmd: "$'kubectl' delete pod foo", expectedType: "non-readonly-kubectl" },
	{ cmd: 'bash -ec "rm -rf /"', expectedType: "dangerous-pattern" },
	{ cmd: '/bin/bash -c "kubectl delete pod foo"', expectedType: "non-readonly-kubectl" },
	{ cmd: "/usr/bin/env rm -rf /", expectedType: "dangerous-pattern" },
	{ cmd: "/usr/bin/kubectl delete pod foo", expectedType: "non-readonly-kubectl" },
	{ cmd: "command rm -rf /", expectedType: "dangerous-pattern" },
	{ cmd: "command kubectl delete pod foo", expectedType: "non-readonly-kubectl" },
	{ cmd: "exec kubectl delete pods", expectedType: "non-readonly-kubectl" },
	{ cmd: "timeout 10 rm -rf /", expectedType: "dangerous-pattern" },
	{ cmd: "nice rm -rf /", expectedType: "dangerous-pattern" },
	{ cmd: "A+=1 rm -rf /", expectedType: "dangerous-pattern" },
	{ cmd: "chmod a=rwx file", expectedType: "dangerous-pattern" },
	{ cmd: "chmod ugo=rwx file", expectedType: "dangerous-pattern" },
	{ cmd: "chmod +rwx file", expectedType: "dangerous-pattern" },
	{ cmd: "kubectl --cache-dir /tmp delete pod foo", expectedType: "non-readonly-kubectl" },
	{ cmd: 'echo "rm -rf /" | bash', expectedType: "dangerous-pattern" },
	{ cmd: 'echo "kubectl delete pod foo" | sh', expectedType: "non-readonly-kubectl" },
];

for (const { cmd, expectedType } of violationCases) {
	const v = findViolation(cmd);
	assert(v !== undefined, `Violation should be detected for: ${cmd}`);
	if (v) {
		assert(v.type === expectedType, `Violation type should be ${expectedType}, got ${v.type} for: ${cmd}`);
	}
}

const safeCases = [
	"echo 'rm -rf /'",
	'echo "sudo reboot"',
	'echo "chmod 777 file"',
	'echo "kubectl delete pod foo"',
	"kubectl get pods -A",
	"kubectl -n prod describe svc my-svc",
	"kubectl logs -f pod-x",
	"k top pods",
	"kubectl diff -f deploy.yaml",
	"cat file.txt | grep error",
	"git status",
	"chmod 644 file.txt",
	"rm single_file.txt",
	"cat << EOF\nrm -rf /\nEOF",
	"cat << EOF\nkubectl delete pod foo\nEOF",
];

for (const cmd of safeCases) {
	const v = findViolation(cmd);
	assert(v === undefined, `Safe command should NOT trigger violation: ${cmd}`);
}

// ---------------------------------------------------------------------------
// 4. Offense Highlighting Tests
// ---------------------------------------------------------------------------
console.log("\n--- 4. Offense Highlighting ---");

{
	const cmd = "echo hello && rm -rf /tmp/test";
	const v = findViolation(cmd);
	assert(v !== undefined, "Should have violation");
	if (v) {
		const highlighted = highlightOffense(cmd, v.highlightRange);
		assert(
			highlighted === "echo hello && \x1b[1;31mrm -rf /tmp/test\x1b[0m",
			`Highlighted string matches expected ANSI format: ${JSON.stringify(highlighted)}`,
		);
	}
}

{
	const cmd = "kubectl get pods; kubectl delete pod foo";
	const v = findViolation(cmd);
	assert(v !== undefined, "Should have violation");
	if (v) {
		const highlighted = highlightOffense(cmd, v.highlightRange);
		assert(
			highlighted === "kubectl get pods; \x1b[1;31mkubectl delete pod foo\x1b[0m",
			`Highlighted string matches expected ANSI format: ${JSON.stringify(highlighted)}`,
		);
	}
}

// Summary
console.log("\n==========================================");
console.log(`Passed: ${passed} | Failed: ${failed}`);
console.log("==========================================");

if (failed > 0) {
	process.exit(1);
}
