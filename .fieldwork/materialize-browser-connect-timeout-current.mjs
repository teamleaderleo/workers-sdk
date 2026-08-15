import { readFile, writeFile } from "node:fs/promises";

const FILE = "packages/miniflare/src/workers/browser-rendering/binding.worker.ts";

function replaceOnce(source, from, to, label) {
  const index = source.indexOf(from);
  if (index === -1) throw new Error(`Unable to find ${label}`);
  if (source.indexOf(from, index + from.length) !== -1) {
    throw new Error(`Found more than one ${label}`);
  }
  return source.slice(0, index) + to + source.slice(index + from.length);
}

let source = await readFile(FILE, "utf8");

source = replaceOnce(
  source,
  `const MAX_BODY_PREVIEW = 2000;`,
  `const MAX_BODY_PREVIEW = 2000;\nconst BROWSER_SESSION_CONNECT_ATTEMPT_TIMEOUT_MS = 2_000;`,
  "browser session connect timeout constant"
);

source = replaceOnce(
  source,
`\t{\n\t\tmaxAttempts = 5,\n\t\tbaseDelayMs = 25,\n\t\tmaxDelayMs = 250,\n\t}: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number } = {}`,
`\t{\n\t\tmaxAttempts = 5,\n\t\tbaseDelayMs = 25,\n\t\tmaxDelayMs = 250,\n\t\tperAttemptTimeoutMs,\n\t}: {\n\t\tmaxAttempts?: number;\n\t\tbaseDelayMs?: number;\n\t\tmaxDelayMs?: number;\n\t\tperAttemptTimeoutMs?: number;\n\t} = {}`,
  "fetchWithConnectRetry options"
);

source = replaceOnce(
  source,
`\tlet lastError: unknown;\n\tfor (let attempt = 0; attempt < maxAttempts; attempt++) {\n\t\ttry {\n\t\t\treturn await fetch(url, init);\n\t\t} catch (e) {\n\t\t\tlastError = e;\n\t\t\tif (!isRetryableFetchError(e) || attempt === maxAttempts - 1) {\n\t\t\t\tbreak;\n\t\t\t}\n\t\t\tconst delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);\n\t\t\tawait new Promise((resolve) => setTimeout(resolve, delay));\n\t\t}\n\t}\n\tthrow lastError;`,
`\tlet lastError: unknown;\n\tconst callerSignal = init?.signal ?? undefined;\n\tfor (let attempt = 0; attempt < maxAttempts; attempt++) {\n\t\tif (callerSignal?.aborted) {\n\t\t\tthrow callerSignal.reason;\n\t\t}\n\t\tconst timeoutSignal =\n\t\t\tperAttemptTimeoutMs === undefined\n\t\t\t\t? undefined\n\t\t\t\t: AbortSignal.timeout(perAttemptTimeoutMs);\n\t\tconst signal =\n\t\t\ttimeoutSignal === undefined\n\t\t\t\t? callerSignal\n\t\t\t\t: callerSignal === undefined\n\t\t\t\t\t? timeoutSignal\n\t\t\t\t\t: AbortSignal.any([callerSignal, timeoutSignal]);\n\t\ttry {\n\t\t\treturn await fetch(\n\t\t\t\turl,\n\t\t\t\tsignal === undefined ? init : { ...init, signal }\n\t\t\t);\n\t\t} catch (e) {\n\t\t\tif (callerSignal?.aborted) {\n\t\t\t\tthrow callerSignal.reason ?? e;\n\t\t\t}\n\t\t\tconst attemptTimedOut = timeoutSignal?.aborted === true;\n\t\t\tlastError = attemptTimedOut\n\t\t\t\t? new Error(\n\t\t\t\t\t\`Chrome DevTools connection attempt timed out after \${perAttemptTimeoutMs}ms (attempt \${attempt + 1}/\${maxAttempts})\`,\n\t\t\t\t\t{ cause: e }\n\t\t\t\t)\n\t\t\t\t: e;\n\t\t\tif (\n\t\t\t\t(!attemptTimedOut && !isRetryableFetchError(e)) ||\n\t\t\t\tattempt === maxAttempts - 1\n\t\t\t) {\n\t\t\t\tbreak;\n\t\t\t}\n\t\t\tconst delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);\n\t\t\tawait new Promise((resolve) => setTimeout(resolve, delay));\n\t\t}\n\t}\n\tthrow lastError;`,
  "fetchWithConnectRetry loop"
);

source = replaceOnce(
  source,
`\t\tconst resp = await fetchWithConnectRetry(wsUrl, {\n\t\t\theaders: { Upgrade: "websocket" },\n\t\t});\n\t\tassert(resp.webSocket !== null, "Expected a WebSocket response");\n\t\tthis.chromeWs = resp.webSocket;`,
`\t\ttry {\n\t\t\tconst resp = await fetchWithConnectRetry(\n\t\t\t\twsUrl,\n\t\t\t\t{ headers: { Upgrade: "websocket" } },\n\t\t\t\t{\n\t\t\t\t\tperAttemptTimeoutMs: BROWSER_SESSION_CONNECT_ATTEMPT_TIMEOUT_MS,\n\t\t\t\t}\n\t\t\t);\n\t\t\tassert(resp.webSocket !== null, "Expected a WebSocket response");\n\t\t\tthis.chromeWs = resp.webSocket;\n\t\t} catch (e) {\n\t\t\tthis.closeSession();\n\t\t\tthrow e;\n\t\t}`,
  "persistent DevTools connection"
);

source = replaceOnce(
  source,
`\tasync #acquireSession(): Promise<SessionInfo> {\n\t\tconst resp = await this.env[SharedBindings.MAYBE_SERVICE_LOOPBACK].fetch(\n\t\t\t"http://localhost/browser/launch"\n\t\t);\n\t\tconst sessionInfo = await parseJsonResponse<SessionInfo>(\n\t\t\tresp,\n\t\t\t"Failed to launch local browser via miniflare loopback (/browser/launch)"\n\t\t);\n\t\tawait this.#fetchSession(sessionInfo.sessionId, "/session-info", {\n\t\t\tmethod: "POST",\n\t\t\tbody: JSON.stringify(sessionInfo),\n\t\t});\n\t\treturn sessionInfo;\n\t}`,
`\tasync #acquireSession(): Promise<SessionInfo> {\n\t\tconst resp = await this.env[SharedBindings.MAYBE_SERVICE_LOOPBACK].fetch(\n\t\t\t"http://localhost/browser/launch"\n\t\t);\n\t\tconst sessionInfo = await parseJsonResponse<SessionInfo>(\n\t\t\tresp,\n\t\t\t"Failed to launch local browser via miniflare loopback (/browser/launch)"\n\t\t);\n\n\t\ttry {\n\t\t\tconst sessionResp = await this.#fetchSession(\n\t\t\t\tsessionInfo.sessionId,\n\t\t\t\t"/session-info",\n\t\t\t\t{\n\t\t\t\t\tmethod: "POST",\n\t\t\t\t\tbody: JSON.stringify(sessionInfo),\n\t\t\t\t}\n\t\t\t);\n\t\t\tif (!sessionResp.ok) {\n\t\t\t\tconst text = await sessionResp.text();\n\t\t\t\tthrow new Error(\n\t\t\t\t\t\`Failed to establish Chrome DevTools connection for browser session \${sessionInfo.sessionId}: upstream returned \${sessionResp.status} \${sessionResp.statusText}\\n\${truncateBody(text)}\`\n\t\t\t\t);\n\t\t\t}\n\t\t\treturn sessionInfo;\n\t\t} catch (e) {\n\t\t\t// /browser/launch registers the Chrome process before BrowserSession\n\t\t\t// setup. Release that ownership if session registration fails.\n\t\t\tconst closeUrl = new URL("http://localhost/browser/close");\n\t\t\tcloseUrl.searchParams.set("sessionId", sessionInfo.sessionId);\n\t\t\ttry {\n\t\t\t\tawait this.env[SharedBindings.MAYBE_SERVICE_LOOPBACK].fetch(closeUrl, {\n\t\t\t\t\tmethod: "POST",\n\t\t\t\t});\n\t\t\t} catch {\n\t\t\t\t// Preserve the registration failure as the primary error.\n\t\t\t}\n\t\t\tthrow e;\n\t\t}\n\t}`,
  "acquireSession registration"
);

await writeFile(FILE, source);
