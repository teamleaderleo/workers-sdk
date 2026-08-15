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

async function applyCandidate() {
	let source = await readFile(PATH, "utf8");

	source = replaceOnce(
		source,
		`\t{\n\t\tmaxAttempts = 5,\n\t\tbaseDelayMs = 25,\n\t\tmaxDelayMs = 250,\n\t}: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number } = {}`,
		`\t{\n\t\tmaxAttempts = 5,\n\t\tbaseDelayMs = 25,\n\t\tmaxDelayMs = 250,\n\t\tperAttemptTimeoutMs = 2_000,\n\t}: {\n\t\tmaxAttempts?: number;\n\t\tbaseDelayMs?: number;\n\t\tmaxDelayMs?: number;\n\t\tperAttemptTimeoutMs?: number;\n\t} = {}`,
		"fetchWithConnectRetry options"
	);

	source = replaceOnce(
		source,
		`\tlet lastError: unknown;\n\tfor (let attempt = 0; attempt < maxAttempts; attempt++) {\n\t\ttry {\n\t\t\treturn await fetch(url, init);\n\t\t} catch (e) {\n\t\t\tlastError = e;\n\t\t\tif (!isRetryableFetchError(e) || attempt === maxAttempts - 1) {\n\t\t\t\tbreak;\n\t\t\t}\n\t\t\tconst delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);\n\t\t\tawait new Promise((resolve) => setTimeout(resolve, delay));\n\t\t}\n\t}\n\tthrow lastError;`,
		`\tlet lastError: unknown;\n\tconst callerSignal = init?.signal ?? undefined;\n\tfor (let attempt = 0; attempt < maxAttempts; attempt++) {\n\t\tif (callerSignal?.aborted) {\n\t\t\tthrow callerSignal.reason;\n\t\t}\n\t\tconst timeoutSignal = AbortSignal.timeout(perAttemptTimeoutMs);\n\t\tconst signal = callerSignal\n\t\t\t? AbortSignal.any([callerSignal, timeoutSignal])\n\t\t\t: timeoutSignal;\n\t\ttry {\n\t\t\treturn await fetch(url, { ...init, signal });\n\t\t} catch (e) {\n\t\t\tif (callerSignal?.aborted) {\n\t\t\t\tthrow callerSignal.reason ?? e;\n\t\t\t}\n\t\t\tconst attemptTimedOut = timeoutSignal.aborted;\n\t\t\tlastError = attemptTimedOut\n\t\t\t\t? new Error(\n\t\t\t\t\t\`Chrome DevTools connection attempt timed out after \${perAttemptTimeoutMs}ms (attempt \${attempt + 1}/\${maxAttempts})\`,\n\t\t\t\t\t{ cause: e }\n\t\t\t\t)\n\t\t\t\t: e;\n\t\t\tif (\n\t\t\t\t(!attemptTimedOut && !isRetryableFetchError(e)) ||\n\t\t\t\tattempt === maxAttempts - 1\n\t\t\t) {\n\t\t\t\tbreak;\n\t\t\t}\n\t\t\tconst delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);\n\t\t\tif (callerSignal) {\n\t\t\t\tawait new Promise<void>((resolve, reject) => {\n\t\t\t\t\tconst onAbort = () => {\n\t\t\t\t\t\tclearTimeout(timer);\n\t\t\t\t\t\treject(callerSignal.reason);\n\t\t\t\t\t};\n\t\t\t\t\tconst timer = setTimeout(() => {\n\t\t\t\t\t\tcallerSignal.removeEventListener(\"abort\", onAbort);\n\t\t\t\t\t\tresolve();\n\t\t\t\t\t}, delay);\n\t\t\t\t\tcallerSignal.addEventListener(\"abort\", onAbort, { once: true });\n\t\t\t\t});\n\t\t\t} else {\n\t\t\t\tawait new Promise((resolve) => setTimeout(resolve, delay));\n\t\t\t}\n\t\t}\n\t}\n\tthrow lastError;`,
		"fetchWithConnectRetry loop"
	);

	source = replaceOnce(
		source,
		`\t\tconst resp = await fetchWithConnectRetry(wsUrl, {\n\t\t\theaders: { Upgrade: \"websocket\" },\n\t\t});`,
		`\t\tconst resp = await fetchWithConnectRetry(wsUrl, {\n\t\t\theaders: { Upgrade: \"websocket\" },\n\t\t\tsignal: req.signal,\n\t\t});`,
		"BrowserSession persistent DevTools connect"
	);

	source = replaceOnce(
		source,
		`\tasync #acquireSession(): Promise<SessionInfo> {`,
		`\tasync #acquireSession(signal?: AbortSignal): Promise<SessionInfo> {`,
		"acquireSession signature"
	);

	source = replaceOnce(
		source,
		`\t\tawait this.#fetchSession(sessionInfo.sessionId, \"/session-info\", {\n\t\t\tmethod: \"POST\",\n\t\t\tbody: JSON.stringify(sessionInfo),\n\t\t});\n\t\treturn sessionInfo;`,
		`\t\tconst sessionResp = await this.#fetchSession(\n\t\t\tsessionInfo.sessionId,\n\t\t\t\"/session-info\",\n\t\t\t{\n\t\t\t\tmethod: \"POST\",\n\t\t\t\tbody: JSON.stringify(sessionInfo),\n\t\t\t\tsignal,\n\t\t\t}\n\t\t);\n\t\tif (!sessionResp.ok) {\n\t\t\tconst text = await sessionResp.text();\n\t\t\tthrow new Error(\n\t\t\t\t\`Failed to establish Chrome DevTools connection for browser session \${sessionInfo.sessionId}: upstream returned \${sessionResp.status} \${sessionResp.statusText}\\n\${truncateBody(text)}\`\n\t\t\t);\n\t\t}\n\t\treturn sessionInfo;`,
		"session registration response handling"
	);

	source = replaceOnce(
		source,
		`\tacquireRoute: RouteHandler = async () => {\n\t\tconst sessionInfo = await this.#acquireSession();`,
		`\tacquireRoute: RouteHandler = async (req) => {\n\t\tconst sessionInfo = await this.#acquireSession(req.signal);`,
		"acquire route signal"
	);

	source = replaceOnce(
		source,
		`\tacquireBrowserRoute: RouteHandler = async () => {\n\t\tconst sessionInfo = await this.#acquireSession();`,
		`\tacquireBrowserRoute: RouteHandler = async (req) => {\n\t\tconst sessionInfo = await this.#acquireSession(req.signal);`,
		"POST devtools browser signal"
	);

	source = replaceOnce(
		source,
		`\t\tconst sessionInfo = await this.#acquireSession();\n\t\tconst doUrl = new URL(req.url);`,
		`\t\tconst sessionInfo = await this.#acquireSession(req.signal);\n\t\tconst doUrl = new URL(req.url);`,
		"GET devtools browser signal"
	);

	await writeFile(PATH, source);
}

async function applyStall() {
	let source = await readFile(PATH, "utf8");
	source = replaceOnce(
		source,
		`\t\t\treturn await fetch(url, { ...init, signal });`,
		`\t\t\treturn await new Promise<Response>((_resolve, reject) => {\n\t\t\t\tconst abort = () =>\n\t\t\t\t\treject(\n\t\t\t\t\t\tsignal.reason ??\n\t\t\t\t\t\t\tnew Error(\"Injected stalled Chrome DevTools connection aborted\")\n\t\t\t\t\t);\n\t\t\t\tif (signal.aborted) {\n\t\t\t\t\tabort();\n\t\t\t\t} else {\n\t\t\t\t\tsignal.addEventListener(\"abort\", abort, { once: true });\n\t\t\t\t}\n\t\t\t});`,
		"connect fetch for deterministic stall"
	);
	await writeFile(PATH, source);
}

async function applyCallerAbortProbe() {
	let source = await readFile(PATH, "utf8");
	source = replaceOnce(
		source,
		`\t\tconst resp = await fetchWithConnectRetry(wsUrl, {\n\t\t\theaders: { Upgrade: \"websocket\" },\n\t\t\tsignal: req.signal,\n\t\t});`,
		`\t\tconst fieldworkCaller = new AbortController();\n\t\tthis.timers.setTimeout(\n\t\t\t() =>\n\t\t\t\tfieldworkCaller.abort(\n\t\t\t\t\tnew Error(\"Injected BrowserSession caller cancellation\")\n\t\t\t\t),\n\t\t\t250\n\t\t);\n\t\tconst resp = await fetchWithConnectRetry(wsUrl, {\n\t\t\theaders: { Upgrade: \"websocket\" },\n\t\t\tsignal: fieldworkCaller.signal,\n\t\t});`,
		"caller-abort probe"
	);
	await writeFile(PATH, source);
}

switch (process.argv[2]) {
	case "candidate":
		await applyCandidate();
		break;
	case "stall":
		await applyStall();
		break;
	case "caller-abort":
		await applyCallerAbortProbe();
		break;
	default:
		throw new Error("Usage: browser-connect-timeout-proof-v2.mjs <candidate|stall|caller-abort>");
}
