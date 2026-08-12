import TOML from "smol-toml";
import { describe, it } from "vitest";
import { normalizeAndValidateConfig } from "../../../src/config/validation";
import type { RawConfig } from "../../../src/config";

function parseAndValidate(literal: string) {
	const rawConfig = TOML.parse(
		`placement = ${literal}`
	) as unknown as RawConfig;
	return normalizeAndValidateConfig(rawConfig, undefined, undefined, {
		env: undefined,
	});
}

describe("placement container validation", () => {
	for (const literal of ['"smart"', "1", "true", '""', "0", "false", "[]"]) {
		it(`reports a config error for non-object placement ${literal}`, ({
			expect,
		}) => {
			const { diagnostics } = parseAndValidate(literal);
			expect(diagnostics.hasErrors()).toBe(true);
			expect(diagnostics.errors.join("\n")).toContain(
				`"placement" should be an object`
			);
		});
	}

	for (const literal of [
		'{ mode = "smart" }',
		'{ mode = "smart", hint = "eu" }',
		'{ mode = "targeted", region = "us-east" }',
	]) {
		it(`still accepts object placement ${literal}`, ({ expect }) => {
			const { diagnostics } = parseAndValidate(literal);
			expect(diagnostics.hasErrors()).toBe(false);
		});
	}
});
