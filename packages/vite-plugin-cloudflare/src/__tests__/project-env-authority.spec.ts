import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { removeDirSync } from "@cloudflare/workers-utils";
import { afterEach, describe, test } from "vitest";
import { resolvePluginConfig } from "../plugin-config";

const viteEnv = { mode: "development", command: "serve" as const };

describe("project environment authority", () => {
	const tempDirs: string[] = [];
	const originalApiToken = process.env.CLOUDFLARE_API_TOKEN;

	afterEach(() => {
		for (const tempDir of tempDirs.splice(0)) {
			removeDirSync(tempDir);
		}
		if (originalApiToken === undefined) {
			delete process.env.CLOUDFLARE_API_TOKEN;
		} else {
			process.env.CLOUDFLARE_API_TOKEN = originalApiToken;
		}
	});

	function createProject(apiToken: string) {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "vite-env-owner-"));
		tempDirs.push(root);

		const configPath = path.join(root, "wrangler.jsonc");
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				name: path.basename(root),
				main: "./src/index.ts",
				compatibility_date: "2024-01-01",
			})
		);
		fs.mkdirSync(path.join(root, "src"), { recursive: true });
		fs.writeFileSync(path.join(root, "src/index.ts"), "export default {}");
		fs.writeFileSync(
			path.join(root, ".env"),
			`CLOUDFLARE_API_TOKEN=${apiToken}\n`
		);

		return { root, configPath };
	}

	test("does not copy project credentials into the host process", async ({
		expect,
	}) => {
		delete process.env.CLOUDFLARE_API_TOKEN;
		const projectA = createProject("sentinel-project-a-token");
		const projectB = createProject("sentinel-project-b-token");

		await resolvePluginConfig(
			{ configPath: projectA.configPath },
			{ root: projectA.root },
			viteEnv
		);
		expect(process.env.CLOUDFLARE_API_TOKEN).toBeUndefined();

		await resolvePluginConfig(
			{ configPath: projectB.configPath },
			{ root: projectB.root },
			viteEnv
		);
		expect(process.env.CLOUDFLARE_API_TOKEN).toBeUndefined();
	});
});
