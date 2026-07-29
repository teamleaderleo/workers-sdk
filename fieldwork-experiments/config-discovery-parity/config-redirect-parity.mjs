import assert from "node:assert/strict";
import path from "node:path";

function wranglerDevSelection({ userConfig, deployConfig }) {
	if (!deployConfig) {
		return userConfig;
	}
	const expectedDeployDir = path.join(
		path.dirname(userConfig),
		".wrangler",
		"deploy"
	);
	if (path.dirname(deployConfig.path) !== expectedDeployDir) {
		throw new Error("ambiguous redirect base");
	}
	return path.resolve(path.dirname(deployConfig.path), deployConfig.configPath);
}

function viteSelection({ userConfig }) {
	// Vite resolves a concrete config path and passes it explicitly to Wrangler.
	return userConfig;
}

const userConfig = "/app/wrangler.jsonc";
const deployConfig = {
	path: "/app/.wrangler/deploy/config.json",
	configPath: "../../dist/server/wrangler.json",
};

const wrangler = wranglerDevSelection({ userConfig, deployConfig });
const vite = viteSelection({ userConfig, deployConfig });

assert.equal(wrangler, "/app/dist/server/wrangler.json");
assert.equal(vite, "/app/wrangler.jsonc");
assert.notEqual(wrangler, vite);

console.log(
	"PASS: Wrangler dev follows the deploy redirect while Vite dev keeps the source config"
);
