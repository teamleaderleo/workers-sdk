import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	findWranglerConfig,
	resolveWranglerConfigPath,
} from "@cloudflare/workers-utils";
import { afterEach, describe, test } from "vitest";
import { getValidatedWranglerConfigPath } from "../workers-configs";

const temporaryDirectories: string[] = [];

function createProject(): string {
	const directory = mkdtempSync(join(tmpdir(), "workers-config-selection-"));
	temporaryDirectories.push(directory);
	return directory;
}

function writeProjectFile(root: string, relativePath: string, contents = "DUMMY") {
	const filePath = join(root, relativePath);
	mkdirSync(join(filePath, ".."), { recursive: true });
	writeFileSync(filePath, contents);
	return filePath;
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("Wrangler and Vite config selection contract", () => {
	test("uses different same-directory format precedence", ({ expect }) => {
		const root = createProject();
		const jsonPath = writeProjectFile(root, "wrangler.json");
		const jsoncPath = writeProjectFile(root, "wrangler.jsonc");

		expect(findWranglerConfig(root).configPath).toBe(jsonPath);
		expect(getValidatedWranglerConfigPath(root, undefined)).toBe(jsoncPath);
	});

	test("uses different search boundaries and can select different directories", ({
		expect,
	}) => {
		const parent = createProject();
		const root = join(parent, "app");
		mkdirSync(root);
		const parentJsonPath = writeProjectFile(parent, "wrangler.json");
		const rootJsoncPath = writeProjectFile(root, "wrangler.jsonc");

		// Workers Utils searches each format upward before trying the next format.
		expect(findWranglerConfig(root).configPath).toBe(parentJsonPath);
		// Vite only checks the configured Vite root.
		expect(getValidatedWranglerConfigPath(root, undefined)).toBe(rootJsoncPath);
	});

	test("Wrangler searches parents while Vite zero-config mode stays root-only", ({
		expect,
	}) => {
		const parent = createProject();
		const root = join(parent, "app");
		mkdirSync(root);
		const parentConfigPath = writeProjectFile(parent, "wrangler.toml");

		expect(findWranglerConfig(root).configPath).toBe(parentConfigPath);
		expect(getValidatedWranglerConfigPath(root, undefined)).toBeUndefined();
	});

	test("Wrangler dev-style redirect selects generated config while Vite selects source config", ({
		expect,
	}) => {
		const root = createProject();
		const sourceConfigPath = writeProjectFile(root, "wrangler.jsonc");
		const generatedConfigPath = writeProjectFile(root, "dist/wrangler.json");
		writeProjectFile(
			root,
			".wrangler/deploy/config.json",
			JSON.stringify({ configPath: "../../dist/wrangler.json" })
		);

		expect(
			findWranglerConfig(root, { useRedirectIfAvailable: true })
		).toMatchObject({
			configPath: generatedConfigPath,
			userConfigPath: sourceConfigPath,
			redirected: true,
		});
		expect(getValidatedWranglerConfigPath(root, undefined)).toBe(
			sourceConfigPath
		);
	});

	test("an explicit generated config path makes both selectors converge", ({
		expect,
	}) => {
		const root = createProject();
		writeProjectFile(root, "wrangler.jsonc");
		const generatedConfigPath = writeProjectFile(root, "dist/wrangler.json");
		writeProjectFile(
			root,
			".wrangler/deploy/config.json",
			JSON.stringify({ configPath: "../../dist/wrangler.json" })
		);

		expect(
			resolveWranglerConfigPath(
				{ config: generatedConfigPath },
				{ useRedirectIfAvailable: true }
			)
		).toMatchObject({
			configPath: generatedConfigPath,
			userConfigPath: generatedConfigPath,
			redirected: false,
		});
		expect(
			getValidatedWranglerConfigPath(root, resolve(root, "dist/wrangler.json"))
		).toBe(generatedConfigPath);
	});
});
