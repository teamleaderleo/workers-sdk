import { readFile, writeFile } from "node:fs/promises";

const BINDING = "packages/miniflare/src/workers/browser-rendering/binding.worker.ts";
const SPEC = "packages/miniflare/test/plugins/browser/index.spec.ts";

function replaceOnce(source, from, to, label) {
  const index = source.indexOf(from);
  if (index === -1) throw new Error(`Unable to find ${label}`);
  if (source.indexOf(from, index + from.length) !== -1) throw new Error(`Found more than one ${label}`);
  return source.slice(0, index) + to + source.slice(index + from.length);
}

async function applyCandidate() {
  let source = await readFile(BINDING, "utf8");

  source = replaceOnce(source,
`\t{\n\t\tmaxAttempts = 5,\n\t\tbaseDelayMs = 25,\n\t\tmaxDelayMs = 250,\n\t}: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number } = {}`,
`\t{\n\t\tmaxAttempts = 5,\n\t\tbaseDelayMs = 25,\n\t\tmaxDelayMs = 250,\n\t\tperAttemptTimeoutMs,\n\t}: {\n\t\tmaxAttempts?: number;\n\t\tbaseDelayMs?: number;\n\t\tmaxDelayMs?: number;\n\t\tperAttemptTimeoutMs?: number;\n\t} = {}`,
"fetchWithConnectRetry options");

  source = replaceOnce(source,
`\tlet lastError: unknown;\n\tfor (let attempt = 0; attempt < maxAttempts; attempt++) {\n\t\ttry {\n\t\t\treturn await fetch(url, init);\n\t\t} catch (e) {\n\t\t\tlastError = e;\n\t\t\tif (!isRetryableFetchError(e) || attempt === maxAttempts - 1) {\n\t\t\t\tbreak;\n\t\t\t}\n\t\t\tconst delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);\n\t\t\tawait new Promise((resolve) => setTimeout(resolve, delay));\n\t\t}\n\t}\n\tthrow lastError;`,
`\tlet lastError: unknown;\n\tconst callerSignal = init?.signal ?? undefined;\n\tfor (let attempt = 0; attempt < maxAttempts; attempt++) {\n\t\tif (callerSignal?.aborted) throw callerSignal.reason;\n\t\tconst timeoutSignal = perAttemptTimeoutMs === undefined\n\t\t\t? undefined\n\t\t\t: AbortSignal.timeout(perAttemptTimeoutMs);\n\t\tconst signal = timeoutSignal === undefined\n\t\t\t? callerSignal\n\t\t\t: callerSignal\n\t\t\t\t? AbortSignal.any([callerSignal, timeoutSignal])\n\t\t\t\t: timeoutSignal;\n\t\ttry {\n\t\t\treturn await fetch(url, { ...init, signal });\n\t\t} catch (e) {\n\t\t\tif (callerSignal?.aborted) throw callerSignal.reason ?? e;\n\t\t\tconst attemptTimedOut = timeoutSignal?.aborted === true;\n\t\t\tlastError = attemptTimedOut\n\t\t\t\t? new Error(\n\t\t\t\t\t`Chrome DevTools connection attempt timed out after ${perAttemptTimeoutMs}ms (attempt ${attempt + 1}/${maxAttempts})`,\n\t\t\t\t\t{ cause: e }\n\t\t\t\t)\n\t\t\t\t: e;\n\t\t\tif ((!attemptTimedOut && !isRetryableFetchError(e)) || attempt === maxAttempts - 1) break;\n\t\t\tconst delayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);\n\t\t\tif (callerSignal) {\n\t\t\t\tawait new Promise<void>((resolve, reject) => {\n\t\t\t\t\tconst timer = setTimeout(() => {\n\t\t\t\t\t\tcallerSignal.removeEventListener("abort", onAbort);\n\t\t\t\t\t\tresolve();\n\t\t\t\t\t}, delayMs);\n\t\t\t\t\tconst onAbort = () => {\n\t\t\t\t\t\tclearTimeout(timer);\n\t\t\t\t\t\treject(callerSignal.reason);\n\t\t\t\t\t};\n\t\t\t\t\tcallerSignal.addEventListener("abort", onAbort, { once: true });\n\t\t\t\t});\n\t\t\t} else {\n\t\t\t\tawait new Promise((resolve) => setTimeout(resolve, delayMs));\n\t\t\t}\n\t\t}\n\t}\n\tthrow lastError;`,
"fetchWithConnectRetry loop");

  source = replaceOnce(source,
`\t\tconst resp = await fetchWithConnectRetry(wsUrl, {\n\t\t\theaders: { Upgrade: "websocket" },\n\t\t});`,
`\t\ttry {\n\t\t\tconst resp = await fetchWithConnectRetry(\n\t\t\t\twsUrl,\n\t\t\t\t{ headers: { Upgrade: "websocket" }, signal: req.signal },\n\t\t\t\t{ perAttemptTimeoutMs: 2_000 }\n\t\t\t);\n\t\t\tassert(resp.webSocket !== null, "Expected a WebSocket response");\n\t\t\tthis.chromeWs = resp.webSocket;\n\t\t} catch (e) {\n\t\t\tthis.closeSession();\n\t\t\tthrow e;\n\t\t}`,
"persistent DevTools connect");

  source = replaceOnce(source,
`\t\tassert(resp.webSocket !== null, "Expected a WebSocket response");\n\t\tthis.chromeWs = resp.webSocket;\n\t\tthis.chromeWs.accept();`,
`\t\tassert(this.chromeWs !== undefined, "Expected Chrome WebSocket to be assigned");\n\t\tthis.chromeWs.accept();`,
"persistent connect assignments");

  source = replaceOnce(source,
`\tasync #acquireSession(): Promise<SessionInfo> {\n\t\tconst resp = await this.env[SharedBindings.MAYBE_SERVICE_LOOPBACK].fetch(\n\t\t\t"http://localhost/browser/launch"\n\t\t);\n\t\tconst sessionInfo = await parseJsonResponse<SessionInfo>(\n\t\t\tresp,\n\t\t\t"Failed to launch local browser via miniflare loopback (/browser/launch)"\n\t\t);\n\t\tawait this.#fetchSession(sessionInfo.sessionId, "/session-info", {\n\t\t\tmethod: "POST",\n\t\t\tbody: JSON.stringify(sessionInfo),\n\t\t});\n\t\treturn sessionInfo;\n\t}`,
`\tasync #acquireSession(signal?: AbortSignal): Promise<SessionInfo> {\n\t\tconst resp = await this.env[SharedBindings.MAYBE_SERVICE_LOOPBACK].fetch(\n\t\t\t"http://localhost/browser/launch"\n\t\t);\n\t\tconst sessionInfo = await parseJsonResponse<SessionInfo>(\n\t\t\tresp,\n\t\t\t"Failed to launch local browser via miniflare loopback (/browser/launch)"\n\t\t);\n\t\ttry {\n\t\t\tconst sessionResp = await this.#fetchSession(sessionInfo.sessionId, "/session-info", {\n\t\t\t\tmethod: "POST",\n\t\t\t\tbody: JSON.stringify(sessionInfo),\n\t\t\t\tsignal,\n\t\t\t});\n\t\t\tif (!sessionResp.ok) {\n\t\t\t\tconst text = await sessionResp.text();\n\t\t\t\tthrow new Error(\n\t\t\t\t\t`Failed to establish Chrome DevTools connection for browser session ${sessionInfo.sessionId}: upstream returned ${sessionResp.status} ${sessionResp.statusText}\\n${truncateBody(text)}`\n\t\t\t\t);\n\t\t\t}\n\t\t\treturn sessionInfo;\n\t\t} catch (e) {\n\t\t\tconst closeUrl = new URL("http://localhost/browser/close");\n\t\t\tcloseUrl.searchParams.set("sessionId", sessionInfo.sessionId);\n\t\t\ttry {\n\t\t\t\tawait this.env[SharedBindings.MAYBE_SERVICE_LOOPBACK].fetch(closeUrl, { method: "POST" });\n\t\t\t} catch {\n\t\t\t\t// Preserve the registration/cancellation failure as the primary error.\n\t\t\t}\n\t\t\tthrow e;\n\t\t}\n\t}`,
"acquireSession");

  source = source.replace(
`\tacquireRoute: RouteHandler = async () => {\n\t\tconst sessionInfo = await this.#acquireSession();`,
`\tacquireRoute: RouteHandler = async (req) => {\n\t\tconst sessionInfo = await this.#acquireSession(req.signal);`);
  source = source.replace(
`\tacquireBrowserRoute: RouteHandler = async () => {\n\t\tconst sessionInfo = await this.#acquireSession();`,
`\tacquireBrowserRoute: RouteHandler = async (req) => {\n\t\tconst sessionInfo = await this.#acquireSession(req.signal);`);
  source = source.replace(
`\t\tconst sessionInfo = await this.#acquireSession();\n\t\tconst doUrl = new URL(req.url);`,
`\t\tconst sessionInfo = await this.#acquireSession(req.signal);\n\t\tconst doUrl = new URL(req.url);`);

  await writeFile(BINDING, source);
}

async function applyFault(kind) {
  let source = await readFile(BINDING, "utf8");
  const needle = `\t\ttry {\n\t\t\treturn await fetch(url, { ...init, signal });`;
  let replacement;
  if (kind === "stall") {
    replacement = `\t\ttry {\n\t\t\tif (perAttemptTimeoutMs !== undefined) {\n\t\t\t\tconsole.log(` + "`FIELDWORK_CONNECT_ATTEMPT ${attempt + 1}`" + `);\n\t\t\t\treturn await new Promise<Response>((_resolve, reject) => {\n\t\t\t\t\tconst abort = () => reject(signal?.reason ?? new Error("Injected stalled DevTools connection aborted"));\n\t\t\t\t\tif (signal?.aborted) abort();\n\t\t\t\t\telse signal?.addEventListener("abort", abort, { once: true });\n\t\t\t\t});\n\t\t\t}\n\t\t\treturn await fetch(url, { ...init, signal });`;
  } else if (kind === "nonretryable") {
    replacement = `\t\ttry {\n\t\t\tif (perAttemptTimeoutMs !== undefined) {\n\t\t\t\tconsole.log(` + "`FIELDWORK_CONNECT_ATTEMPT ${attempt + 1}`" + `);\n\t\t\t\tthrow new Error("Injected non-retryable DevTools connection failure");\n\t\t\t}\n\t\t\treturn await fetch(url, { ...init, signal });`;
  } else throw new Error(`unknown fault: ${kind}`);
  source = replaceOnce(source, needle, replacement, `${kind} fault injection`);
  await writeFile(BINDING, source);
}

async function applyCallerFault() {
  let source = await readFile(BINDING, "utf8");
  source = replaceOnce(source,
`\t\t\tconst resp = await fetchWithConnectRetry(\n\t\t\t\twsUrl,\n\t\t\t\t{ headers: { Upgrade: "websocket" }, signal: req.signal },\n\t\t\t\t{ perAttemptTimeoutMs: 2_000 }\n\t\t\t);`,
`\t\t\tconst fieldworkCaller = new AbortController();\n\t\t\tthis.timers.setTimeout(\n\t\t\t\t() => fieldworkCaller.abort(new Error("Injected BrowserSession caller cancellation")),\n\t\t\t\t250\n\t\t\t);\n\t\t\tconst resp = await fetchWithConnectRetry(\n\t\t\t\twsUrl,\n\t\t\t\t{ headers: { Upgrade: "websocket" }, signal: fieldworkCaller.signal },\n\t\t\t\t{ perAttemptTimeoutMs: 2_000 }\n\t\t\t);`,
"caller precedence injection");
  await writeFile(BINDING, source);
}

async function instrumentCleanup() {
  let source = await readFile(BINDING, "utf8");
  source = replaceOnce(source,
`\t\t\ttry {\n\t\t\t\tawait this.env[SharedBindings.MAYBE_SERVICE_LOOPBACK].fetch(closeUrl, { method: "POST" });\n\t\t\t} catch {`,
`\t\t\ttry {\n\t\t\t\tawait this.env[SharedBindings.MAYBE_SERVICE_LOOPBACK].fetch(closeUrl, { method: "POST" });\n\t\t\t\tconst statusUrl = new URL("http://localhost/browser/status");\n\t\t\t\tstatusUrl.searchParams.set("sessionId", sessionInfo.sessionId);\n\t\t\t\tconst statusResp = await this.env[SharedBindings.MAYBE_SERVICE_LOOPBACK].fetch(statusUrl);\n\t\t\t\tconsole.log(` + "`FIELDWORK_CLEANUP_STATUS ${sessionInfo.sessionId} ${statusResp.status}`" + `);\n\t\t\t} catch {`,
"cleanup instrumentation");
  await writeFile(BINDING, source);
}

async function addFocusedTest(kind) {
  let source = await readFile(SPEC, "utf8");
  const expected = kind === "stall"
    ? "Chrome DevTools connection attempt timed out after 2000ms (attempt 5/5)"
    : kind === "caller"
      ? "Injected BrowserSession caller cancellation"
      : "Injected non-retryable DevTools connection failure";
  const marker = `\n\ttest(\n\t\t"fieldwork ${kind} acquisition probe",\n\t\t{ timeout: 20_000 },\n\t\tasync ({ expect }) => {\n\t\t\tconst mf = new Miniflare({\n\t\t\t\tworkers: [{ config: { type: "worker", name: "worker", compatibilityDate: "2024-11-20", manifest: singleModuleManifest(BROWSER_WORKER_SCRIPT()), env: { MYBROWSER: { type: "browser" } } } }],\n\t\t\t});\n\t\t\tuseDispose(mf);\n\t\t\tconst res = await mf.dispatchFetch("https://localhost/session");\n\t\t\tconst text = await res.text();\n\t\t\tconsole.log("FIELDWORK_RESPONSE", res.status, text);\n\t\t\texpect(text).toContain(${JSON.stringify(expected)});\n\t\t}\n\t);\n`;
  const idx = source.lastIndexOf("\n});");
  if (idx === -1) throw new Error("Unable to find browser describe close");
  source = source.slice(0, idx) + marker + source.slice(idx);
  await writeFile(SPEC, source);
}

switch (process.argv[2]) {
  case "candidate": await applyCandidate(); break;
  case "stall": await applyFault("stall"); break;
  case "nonretryable": await applyFault("nonretryable"); break;
  case "caller-fault": await applyCallerFault(); break;
  case "cleanup-log": await instrumentCleanup(); break;
  case "stall-test": await addFocusedTest("stall"); break;
  case "nonretryable-test": await addFocusedTest("nonretryable"); break;
  case "caller-focused-test": await addFocusedTest("caller"); break;
  default: throw new Error("usage: v3 <candidate|stall|nonretryable|caller-fault|cleanup-log|stall-test|nonretryable-test|caller-focused-test>");
}
