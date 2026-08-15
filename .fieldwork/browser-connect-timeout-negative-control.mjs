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

let binding = await readFile(BINDING, "utf8");
const fetchBlock = `\t\ttry {\n\t\t\treturn await fetch(\n\t\t\t\turl,\n\t\t\t\tsignal === undefined ? init : { ...init, signal }\n\t\t\t);`;
const injectedFetch = `\t\ttry {\n\t\t\tif (perAttemptTimeoutMs !== undefined) {\n\t\t\t\tconsole.log(\`FIELDWORK_CONNECT_ATTEMPT \${attempt + 1}\`);\n\t\t\t\tthrow new Error("Injected non-retryable DevTools connection failure");\n\t\t\t}\n\t\t\treturn await fetch(\n\t\t\t\turl,\n\t\t\t\tsignal === undefined ? init : { ...init, signal }\n\t\t\t);`;
binding = replaceOnce(binding, fetchBlock, injectedFetch, "connect fetch block");

binding = replaceOnce(
  binding,
  `\t\t\ttry {\n\t\t\t\tawait this.env[SharedBindings.MAYBE_SERVICE_LOOPBACK].fetch(closeUrl, {\n\t\t\t\t\tmethod: "POST",\n\t\t\t\t});\n\t\t\t} catch {`,
  `\t\t\ttry {\n\t\t\t\tawait this.env[SharedBindings.MAYBE_SERVICE_LOOPBACK].fetch(closeUrl, {\n\t\t\t\t\tmethod: "POST",\n\t\t\t\t});\n\t\t\t\tconst statusUrl = new URL("http://localhost/browser/status");\n\t\t\t\tstatusUrl.searchParams.set("sessionId", sessionInfo.sessionId);\n\t\t\t\tconst statusResp = await this.env[SharedBindings.MAYBE_SERVICE_LOOPBACK].fetch(statusUrl);\n\t\t\t\tconsole.log(\`FIELDWORK_REGISTRY_STATUS \${sessionInfo.sessionId} \${statusResp.status}\`);\n\t\t\t} catch {`,
  "registration cleanup block"
);
await writeFile(BINDING, binding);

let spec = await readFile(SPEC, "utf8");
const test = `
\ttest(
\t\t"fieldwork exact Candidate B non-retryable probe",
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
\t\t\tconst res = await mf.dispatchFetch("https://localhost/session");
\t\t\tconst text = await res.text();
\t\t\tconsole.log("FIELDWORK_RESPONSE", res.status, text);
\t\t\texpect(text).toContain("Injected non-retryable DevTools connection failure");
\t\t\texpect(text).toContain("Failed to establish Chrome DevTools connection for browser session");
\t\t}
\t);
`;
const idx = spec.lastIndexOf("\n});");
if (idx === -1) throw new Error("Unable to find browser describe close");
spec = spec.slice(0, idx) + test + spec.slice(idx);
await writeFile(SPEC, spec);
