import TOML from "smol-toml";
import { describe, it } from "vitest";
import { normalizeAndValidateConfig } from "../../../src/config/validation";
import type { RawConfig } from "../../../src/config";

function validateToml(toml: string) {
	const rawConfig = TOML.parse(toml) as unknown as RawConfig;
	return normalizeAndValidateConfig(rawConfig, undefined, undefined, {
		env: undefined,
	});
}

describe("dev non-finite numeric configuration", () => {
	it.each([
		["nan", "NaN"],
		["+inf", "positive infinity"],
		["-inf", "negative infinity"],
	] as const)(
		"currently accepts TOML %s for dev.port",
		(literal, expectedKind, { expect }) => {
			const { config, diagnostics } = validateToml(`
				[dev]
				port = ${literal}
			`);

			expect(typeof config.dev.port).toBe("number");
			expect(Number.isFinite(config.dev.port)).toBe(false);
			if (expectedKind === "NaN") {
				expect(Number.isNaN(config.dev.port)).toBe(true);
			} else if (expectedKind === "positive infinity") {
				expect(config.dev.port).toBe(Number.POSITIVE_INFINITY);
			} else {
				expect(config.dev.port).toBe(Number.NEGATIVE_INFINITY);
			}
			expect(diagnostics.hasErrors()).toBe(false);
		}
	);

	it.each(["nan", "+inf", "-inf"])(
		"currently accepts TOML %s for dev.inspector_port",
		(literal, { expect }) => {
			const { config, diagnostics } = validateToml(`
				[dev]
				inspector_port = ${literal}
			`);

			expect(typeof config.dev.inspector_port).toBe("number");
			expect(Number.isFinite(config.dev.inspector_port)).toBe(false);
			expect(diagnostics.hasErrors()).toBe(false);
		}
	);

	it("continues accepting ordinary finite dev ports", ({ expect }) => {
		const { config, diagnostics } = validateToml(`
			[dev]
			port = 8787
			inspector_port = 9229
		`);

		expect(config.dev.port).toBe(8787);
		expect(config.dev.inspector_port).toBe(9229);
		expect(diagnostics.hasErrors()).toBe(false);
	});

	it("retains the existing wrong-type diagnostic", ({ expect }) => {
		const { diagnostics } = validateToml(`
			[dev]
			port = "8787"
		`);

		expect(diagnostics.renderErrors()).toContain(
			'Expected "dev.port" to be of type number but got "8787".'
		);
	});
});
