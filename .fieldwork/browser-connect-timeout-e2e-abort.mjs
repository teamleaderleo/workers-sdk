import { readFile, writeFile } from "node:fs/promises";

const BINDING = "packages/miniflare/src/workers/browser-rendering/binding.worker.ts";
const SPEC = "packages/miniflare/test/plugins/browser/index.spec.ts";

function replaceOnce(source, from, to, label) {
  const index = source.indexOf(from);
  if (index === -1) throw new Error(`Unable to find ${label}`);
  if (source.indexOf(from, index + from.length) !== -1) throw new Error(`Found more than one ${label}`);
  return source.slice(0, index) + to + source.slice(index + from.length);
}

async function widenInternalDeadline() {
  let source = await readFile(BINDING, "utf8");
  source = replaceOnce(
    source,
    "{ perAttemptTimeoutMs: 2_000 }",
    "{ perAttemptTimeoutMs: 30_000 }",
    "persistent DevTools attempt deadline"
  );
  await writeFile(BINDING, source);
}

async function addProbe() {
  let source = await readFile(SPEC, "utf8");
  source = replaceOnce(
    source,
`\tasync fetch(request, env) {\n\t\tif (request.url.endsWith("session")) {`,
`\tasync fetch(request, env) {\n\t\tif (request.url.endsWith("session-abort")) {\n\t\t\tconst controller = new AbortController();\n\t\t\tsetTimeout(\n\t\t\t\t() => controller.abort(new Error("Injected user-worker caller cancellation")),\n\t\t\t\t8_000\n\t\t\t);\n\t\t\ttry {\n\t\t\t\tconst response = await env.MYBROWSER.fetch(\n\t\t\t\t\t"https://localhost/v1/acquire",\n\t\t\t\t\t{ signal: controller.signal }\n\t\t\t\t);\n\t\t\t\treturn new Response(\n\t\t\t\t\t\`FIELDWORK_CALLER_UNEXPECTED_RESPONSE \${response.status} \${await response.text()}\`\n\t\t\t\t);\n\t\t\t} catch (e) {\n\t\t\t\treturn new Response(\n\t\t\t\t\t\`FIELDWORK_CALLER_ABORT \${e?.name ?? "Error"}: \${e?.message ?? String(e)}\`\n\t\t\t\t);\n\t\t\t}\n\t\t}\n\t\tif (request.url.endsWith("session")) {`,
    "browser test worker fetch route"
  );

  const marker = `
\ttest(
\t\t"fieldwork end-to-end caller abort probe",
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
\t\t\tconst res = await mf.dispatchFetch("https://localhost/session-abort");
\t\t\tconst text = await res.text();
\t\t\tconst elapsed = Date.now() - started;
\t\t\tconsole.log("FIELDWORK_E2E_CALLER_RESPONSE", elapsed, res.status, text);
\t\t\t// Give downstream cancellation cleanup time to become observable before test disposal.
\t\t\tawait new Promise((resolve) => setTimeout(resolve, 2_000));
\t\t\texpect(text).toContain("FIELDWORK_CALLER_ABORT");
\t\t\texpect(text).toContain("Injected user-worker caller cancellation");
\t\t\texpect(elapsed).toBeGreaterThanOrEqual(7_000);
\t\t\texpect(elapsed).toBeLessThan(12_000);
\t\t}
\t);
`;
  const idx = source.lastIndexOf("\n});");
  if (idx === -1) throw new Error("Unable to find browser describe close");
  source = source.slice(0, idx) + marker + source.slice(idx);
  await writeFile(SPEC, source);
}

switch (process.argv[2]) {
  case "widen":
    await widenInternalDeadline();
    break;
  case "test":
    await addProbe();
    break;
  default:
    throw new Error("usage: browser-connect-timeout-e2e-abort.mjs <widen|test>");
}
