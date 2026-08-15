import { readFile, writeFile } from "node:fs/promises";

const PATH = "packages/miniflare/src/workers/browser-rendering/binding.worker.ts";

function replaceOnce(source, from, to, label) {
	const index = source.indexOf(from);
	if (index === -1) throw new Error(`Unable to find ${label}`);
	if (source.indexOf(from, index + from.length) !== -1) {
		throw new Error(`Found more than one ${label}`);
	}
	return source.slice(0, index) + to + source.slice(index + from.length);
}

async function applyDeadline() {
	let source = await readFile(PATH, "utf8");
	source = replaceOnce(
		source,
		`\t{\n\t\tmaxAttempts = 5,\n\t\tbaseDelayMs = 25,\n\t\tmaxDelayMs = 250,\n\t}: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number } = {}`,
		`\t{\n\t\tmaxAttempts = 5,\n\t\tbaseDelayMs = 25,\n\t\tmaxDelayMs = 250,\n\t\tperAttemptTimeoutMs = 2_000,\n\t}: {\n\t\tmaxAttempts?: number;\n\t\tbaseDelayMs?: number;\n\t\tmaxDelayMs?: number;\n\t\tperAttemptTimeoutMs?: number;\n\t} = {}`,
		"fetchWithConnectRetry options"
	);
	source = replaceOnce(
		source,
		`\tfor (let attempt = 0; attempt < maxAttempts; attempt++) {\n\t\ttry {\n\t\t\treturn await fetch(url, init);\n\t\t} catch (e) {\n\t\t\tlastError = e;\n\t\t\tif (!isRetryableFetchError(e) || attempt === maxAttempts - 1) {\n\t\t\t\tbreak;\n\t\t\t}\n\t\t\tconst delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);\n\t\t\tawait new Promise((resolve) => setTimeout(resolve, delay));\n\t\t}\n\t}`,
		`\tfor (let attempt = 0; attempt < maxAttempts; attempt++) {\n\t\tconst timeoutSignal = AbortSignal.timeout(perAttemptTimeoutMs);\n\t\tconst callerSignal = init?.signal;\n\t\tconst signal = callerSignal\n\t\t\t? AbortSignal.any([callerSignal, timeoutSignal])\n\t\t\t: timeoutSignal;\n\t\ttry {\n\t\t\treturn await fetch(url, { ...init, signal });\n\t\t} catch (e) {\n\t\t\tconst attemptTimedOut =\n\t\t\t\ttimeoutSignal.aborted && !(callerSignal?.aborted ?? false);\n\t\t\tlastError = attemptTimedOut\n\t\t\t\t? new Error(\n\t\t\t\t\t\`Chrome DevTools connection attempt timed out after \${perAttemptTimeoutMs}ms (attempt \${attempt + 1}/\${maxAttempts})\`,\n\t\t\t\t\t{ cause: e }\n\t\t\t\t)\n\t\t\t\t: e;\n\t\t\tif (\n\t\t\t\t(!attemptTimedOut && !isRetryableFetchError(e)) ||\n\t\t\t\tattempt === maxAttempts - 1\n\t\t\t) {\n\t\t\t\tbreak;\n\t\t\t}\n\t\t\tconst delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);\n\t\t\tawait new Promise((resolve) => setTimeout(resolve, delay));\n\t\t}\n\t}`,
		"fetchWithConnectRetry loop"
	);
	await writeFile(PATH, source);
}

async function applyFault() {
	let source = await readFile(PATH, "utf8");
	source = replaceOnce(
		source,
		`\t\t\treturn await fetch(url, { ...init, signal });`,
		`\t\t\treturn await new Promise<Response>((_resolve, reject) => {\n\t\t\t\tconst abort = () =>\n\t\t\t\t\treject(new Error(\"Injected stalled Chrome DevTools connection aborted\"));\n\t\t\t\tif (signal.aborted) abort();\n\t\t\t\telse signal.addEventListener(\"abort\", abort, { once: true });\n\t\t\t});`,
		"connect fetch for fault injection"
	);
	await writeFile(PATH, source);
}

switch (process.argv[2]) {
	case "deadline":
		await applyDeadline();
		break;
	case "fault":
		await applyFault();
		break;
	default:
		throw new Error("Usage: browser-connect-timeout-experiment.mjs <deadline|fault>");
}
