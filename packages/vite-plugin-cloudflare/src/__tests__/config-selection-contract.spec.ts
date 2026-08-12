import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
	mkdirSync(dirname(filePath), { recursive: true });
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

	test("format-first Wrangler discovery lets parent JSON beat nearer JSONC and TOML", ({
		expect,
	}) => {
		for (const childConfigName of ["wrangler.jsonc", "wrangler.toml"]) {
			const parent = createProject();
			const root = join(parent, "app");
			mkdirSync(root);
			const parentJsonPath = writeProjectFile(parent, "wrangler.json");
			const childConfigPath = writeProjectFile(root, childConfigName);

			// Workers Utils completes the JSON ancestor search before trying the
			// next supported filename, so the farther parent file wins.
			expect(findWranglerConfig(root).configPath).toBe(parentJsonPath);
			// Vite only checks the configured root and therefore selects the nearer
			// root-owned file.
			expect(getValidatedWranglerConfigPath(root, undefined)).toBe(
				childConfigPath
			);
		}
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

	test("redirect-enabled Workers Utils selects generated config while Vite selects source config", ({
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

	test("a Vite-relative explicit generated path can be handed to Workers Utils without redirect discovery", ({
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

		const viteSelectedPath = getValidatedWranglerConfigPath(
			root,
			"dist/wrangler.json"
		);
		expect(viteSelectedPath).toBe(generatedConfigPath);
		expect(
			resolveWranglerConfigPath(
				{ config: viteSelectedPath },
				{ useRedirectIfAvailable: true }
			)
		).toMatchObject({
			configPath: generatedConfigPath,
			userConfigPath: generatedConfigPath,
			redirected: false,
		});
	});
});