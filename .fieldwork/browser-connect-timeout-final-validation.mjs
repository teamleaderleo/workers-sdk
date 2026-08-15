import { readFile, writeFile } from "node:fs/promises";

const BINDING = "packages/miniflare/src/workers/browser-rendering/binding.worker.ts";
const SPEC = "packages/miniflare/test/plugins/browser/index.spec.ts";

function replaceOnce(source, from, to, label) {
  const index = source.indexOf(from);
  if (index === -1) throw new Error(`Unable to find ${label}`);
  if (source.indexOf(from, index + from.length) !== -1) {
    throw new Error(`Found more than one ${label}`);
  }
  return source.slice(0, index) + to + source.slice(index + from.length);
}

async function injectConnectFault(kind) {
  let source = await readFile(BINDING, "utf8");
  const fetchBlock = `\t\ttry {\n\t\t\treturn await fetch(\n\t\t\t\turl,\n\t\t\t\tsignal === undefined ? init : { ...init, signal }\n\t\t\t);`;

  let replacement;
  if (kind === "stall") {
    replacement = `\t\ttry {\n\t\t\tif (perAttemptTimeoutMs !== undefined) {\n\t\t\t\tconsole.log(\`FIELDWORK_CONNECT_ATTEMPT \${attempt + 1}\`);\n\t\t\t\treturn await new Promise<Response>((_resolve, reject) => {\n\t\t\t\t\tconst onAbort = () =>\n\t\t\t\t\t\treject(signal?.reason ?? new Error("Injected stalled DevTools connection aborted"));\n\t\t\t\t\tif (signal?.aborted) onAbort();\n\t\t\t\t\telse signal?.addEventListener("abort", onAbort, { once: true });\n\t\t\t\t});\n\t\t\t}\n\t\t\treturn await fetch(\n\t\t\t\turl,\n\t\t\t\tsignal === undefined ? init : { ...init, signal }\n\t\t\t);`;
  } else if (kind === "nonretryable") {
    replacement = `\t\ttry {\n\t\t\tif (perAttemptTimeoutMs !== undefined) {\n\t\t\t\tconsole.log(\`FIELDWORK_CONNECT_ATTEMPT \${attempt + 1}\`);\n\t\t\t\tthrow new Error("Injected non-retryable DevTools connection failure");\n\t\t\t}\n\t\t\treturn await fetch(\n\t\t\t\turl,\n\t\t\t\tsignal === undefined ? init : { ...init, signal }\n\t\t\t);`;
  } else {
    throw new Error(`Unknown fault: ${kind}`);
  }

  source = replaceOnce(source, fetchBlock, replacement, `${kind} connect fault`);
  await writeFile(BINDING, source);
}

async function instrumentRegistryRelease() {
  let source = await readFile(BINDING, "utf8");
  source = replaceOnce(
    source,
`\t\t\ttry {\n\t\t\t\tawait this.env[SharedBindings.MAYBE_SERVICE_LOOPBACK].fetch(closeUrl, {\n\t\t\t\t\tmethod: "POST",\n\t\t\t\t});\n\t\t\t} catch {`,
`\t\t\ttry {\n\t\t\t\tawait this.env[SharedBindings.MAYBE_SERVICE_LOOPBACK].fetch(closeUrl, {\n\t\t\t\t\tmethod: "POST",\n\t\t\t\t});\n\t\t\t\tconst statusUrl = new URL("http://localhost/browser/status");\n\t\t\t\tstatusUrl.searchParams.set("sessionId", sessionInfo.sessionId);\n\t\t\t\tconst statusResp = await this.env[SharedBindings.MAYBE_SERVICE_LOOPBACK].fetch(statusUrl);\n\t\t\t\tconsole.log(\`FIELDWORK_REGISTRY_STATUS \${sessionInfo.sessionId} \${statusResp.status}\`);\n\t\t\t} catch {`,
    "registration cleanup block"
  );
  await writeFile(BINDING, source);
}

async function addFocusedTest(kind) {
  let source = await readFile(SPEC, "utf8");
  const expected =
    kind === "stall"
      ? "Chrome DevTools connection attempt timed out after 2000ms (attempt 5/5)"
      : "Injected non-retryable DevTools connection failure";

  const marker = `
\ttest(
\t\t"fieldwork exact Candidate B ${kind} probe",
\t\t{ timeout: 20_000 },
\t\tasync ({ expect }) => {
\t\t\tconst mf = new Miniflare({
\t\t\t\tworkers: [
\t\t\t\t\t{
\t\t\t\t\t\tconfig: {
\t\t\t\t\t\t\ttype: "worker",
\t\t\t\t\t\t\tname: "worker",
\t\t\t\t\t\t\tcompatibilityDate: "2024-11-20",
\t\t\t\t\t\t\tmanifest: singleModuleManifest(BROWSER_WORKER_SCRIPT()),
\t\t\t\t\t\t\tenv: { MYBROWSER: { type: "browser" } },
\t\t\t\t\t\t},
\t\t\t\t\t},
\t\t\t\t],
\t\t\t});
\t\t\tuseDispose(mf);
\t\t\tconst started = Date.now();
\t\t\tconst res = await mf.dispatchFetch("https://localhost/session");
\t\t\tconst text = await res.text();
\t\t\tconsole.log("FIELDWORK_RESPONSE", Date.now() - started, res.status, text);
\t\t\texpect(text).toContain(${JSON.stringify(expected)});
\t\t\t${kind === "stall" ? 'expect(text).toContain("Failed to establish Chrome DevTools connection for browser session");' : ""}
\t\t}
\t);
`;

  const idx = source.lastIndexOf("\n});");
  if (idx === -1) throw new Error("Unable to find browser describe close");
  source = source.slice(0, idx) + marker + source.slice(idx);
  await writeFile(SPEC, source);
}

switch (process.argv[2]) {
  case "stall":
    await injectConnectFault("stall");
    break;
  case "nonretryable":
    await injectConnectFault("nonretryable");
    break;
  case "registry":
    await instrumentRegistryRelease();
    break;
  case "stall-test":
    await addFocusedTest("stall");
    break;
  case "nonretryable-test":
    await addFocusedTest("nonretryable");
    break;
  default:
    throw new Error(
      "usage: browser-connect-timeout-final-validation.mjs <stall|nonretryable|registry|stall-test|nonretryable-test>"
    );
}
