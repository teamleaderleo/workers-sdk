import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { removeDirSync } from "@cloudflare/workers-utils";
import { afterEach, describe, test } from "vitest";
import { resolvePluginConfig } from "../plugin-config";

const TOKEN_ENV = "CLOUDFLARE_API_TOKEN";
const viteEnv = { mode: "development", command: "serve" as const };
let projectCounter = 0;

function createProject(
	token?: string,
	options: { invalidWorkerName?: boolean } = {}
): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "vite-env-authority-"));
	const workerName = options.invalidWorkerName
		? "INVALID_WORKER_NAME"
		: `vite-env-authority-${++projectCounter}`;
	fs.mkdirSync(path.join(root, "src"), { recursive: true });
	fs.writeFileSync(path.join(root, "src/index.ts"), "export default {}\n");
	fs.writeFileSync(
		path.join(root, "wrangler.jsonc"),
		JSON.stringify({
			name: workerName,
			main: "./src/index.ts",
			compatibility_date: "2025-01-01",
		})
	);
	if (token !== undefined) {
		fs.writeFileSync(
			path.join(root, ".env.development"),
			`${TOKEN_ENV}=${token}\n`
		);
	}
	return root;
}

describe("resolvePluginConfig project environment authority", () => {
	const roots: string[] = [];
	const originalToken = process.env[TOKEN_ENV];

	afterEach(() => {
		if (originalToken === undefined) {
			delete process.env[TOKEN_ENV];
		} else {
			process.env[TOKEN_ENV] = originalToken;
		}
		for (const root of roots.splice(0)) {
			removeDirSync(root);
		}
	});

	test("a later project with its own token inherits the earlier process value", async ({
		expect,
	}) => {
		delete process.env[TOKEN_ENV];
		const projectA = createProject("fieldwork-project-a");
		const projectB = createProject("fieldwork-project-b");
		roots.push(projectA, projectB);

		await resolvePluginConfig({}, { root: projectA }, viteEnv);
		expect(process.env[TOKEN_ENV]).toBe("fieldwork-project-a");

		await resolvePluginConfig({}, { root: projectB }, viteEnv);
		expect(process.env[TOKEN_ENV]).toBe("fieldwork-project-a");
	});

	test("a later project without a token inherits the earlier project token", async ({
		expect,
	}) => {
		delete process.env[TOKEN_ENV];
		const projectA = createProject("fieldwork-project-a");
		const projectB = createProject();
		roots.push(projectA, projectB);

		await resolvePluginConfig({}, { root: projectA }, viteEnv);
		await resolvePluginConfig({}, { root: projectB }, viteEnv);

		expect(process.env[TOKEN_ENV]).toBe("fieldwork-project-a");
	});

	test("an existing host token remains authoritative over project dotenv values", async ({
		expect,
	}) => {
		process.env[TOKEN_ENV] = "fieldwork-host-token";
		const project = createProject("fieldwork-project-token");
		roots.push(project);

		await resolvePluginConfig({}, { root: project }, viteEnv);

		expect(process.env[TOKEN_ENV]).toBe("fieldwork-host-token");
	});

	test("a configuration failure leaves the project token in the host environment", async ({
		expect,
	}) => {
		delete process.env[TOKEN_ENV];
		const project = createProject("fieldwork-failed-project", {
			invalidWorkerName: true,
		});
		roots.push(project);

		await expect(
			resolvePluginConfig({}, { root: project }, viteEnv)
		).rejects.toThrow("Expected \"name\"");
		expect(process.env[TOKEN_ENV]).toBe("fieldwork-failed-project");
	});
});