import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function upwardFind(start, filename) {
	let current = path.resolve(start);
	while (true) {
		const candidate = path.join(current, filename);
		if (existsSync(candidate)) return candidate;
		const parent = path.dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

function wranglerFind(root) {
	return (
		upwardFind(root, "wrangler.json") ??
		upwardFind(root, "wrangler.jsonc") ??
		upwardFind(root, "wrangler.toml")
	);
}

function viteFind(root) {
	for (const extension of ["jsonc", "json", "toml"]) {
		const candidate = path.join(root, `wrangler.${extension}`);
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

function touch(file) {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, "{}\n");
}

const temp = mkdtempSync(path.join(os.tmpdir(), "workers-config-parity-"));
try {
	const results = [];

	const sameRoot = path.join(temp, "same-root");
	touch(path.join(sameRoot, "wrangler.json"));
	touch(path.join(sameRoot, "wrangler.jsonc"));
	results.push({
		scenario: "same root: json + jsonc",
		wrangler: wranglerFind(sameRoot),
		vite: viteFind(sameRoot),
	});

	const parentWins = path.join(temp, "parent-wins");
	const child = path.join(parentWins, "apps", "web");
	touch(path.join(parentWins, "wrangler.json"));
	touch(path.join(child, "wrangler.jsonc"));
	results.push({
		scenario: "parent json + child jsonc",
		wrangler: wranglerFind(child),
		vite: viteFind(child),
	});

	const upwardOnly = path.join(temp, "upward-only");
	const nested = path.join(upwardOnly, "packages", "worker");
	touch(path.join(upwardOnly, "wrangler.jsonc"));
	mkdirSync(nested, { recursive: true });
	results.push({
		scenario: "parent jsonc only",
		wrangler: wranglerFind(nested),
		vite: viteFind(nested),
	});

	const tomlOnly = path.join(temp, "toml-only");
	touch(path.join(tomlOnly, "wrangler.toml"));
	results.push({
		scenario: "same root: toml only",
		wrangler: wranglerFind(tomlOnly),
		vite: viteFind(tomlOnly),
	});

	assert.equal(path.basename(results[0].wrangler), "wrangler.json");
	assert.equal(path.basename(results[0].vite), "wrangler.jsonc");
	assert.equal(results[1].wrangler, path.join(parentWins, "wrangler.json"));
	assert.equal(results[1].vite, path.join(child, "wrangler.jsonc"));
	assert.equal(results[2].wrangler, path.join(upwardOnly, "wrangler.jsonc"));
	assert.equal(results[2].vite, undefined);
	assert.equal(results[3].wrangler, results[3].vite);

	console.table(
		results.map((row) => ({
			scenario: row.scenario,
			wrangler: row.wrangler ? path.relative(temp, row.wrangler) : "<none>",
			vite: row.vite ? path.relative(temp, row.vite) : "<none>",
		}))
	);
	console.log(
		"PASS: the two discovery algorithms select different files in three realistic layouts."
	);
} finally {
	rmSync(temp, { recursive: true, force: true });
}
