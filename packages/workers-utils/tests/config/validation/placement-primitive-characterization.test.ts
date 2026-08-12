import TOML from "smol-toml";
import { describe, it } from "vitest";
import { normalizeAndValidateConfig } from "../../../src/config/validation";
import type { RawConfig } from "../../../src/config";

function parseAndValidate(literal: string) {
	const rawConfig = TOML.parse(`placement = ${literal}`) as unknown as RawConfig;
	return normalizeAndValidateConfig(rawConfig, undefined, undefined, {
		env: undefined,
	});
}

describe("primitive placement validation", () => {
	for (const literal of ['"smart"', "1", "true"]) {
		it(`throws for truthy primitive placement ${literal}`, ({ expect }) => {
			expect(() => parseAndValidate(literal)).toThrow(TypeError);
		});
	}

	for (const literal of ['""', "0", "false"]) {
		it(`accepts falsy primitive placement ${literal} without a diagnostic`, ({
			expect,
		}) => {
			const { config, diagnostics } = parseAndValidate(literal);
			expect(diagnostics.hasErrors()).toBe(false);
			expect(config.placement).toEqual(TOML.parse(`value = ${literal}`).value);
		});
	}
});
