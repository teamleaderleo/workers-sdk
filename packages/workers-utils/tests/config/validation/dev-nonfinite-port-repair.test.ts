import TOML from "smol-toml";
import { describe, expect, it } from "vitest";
import { normalizeAndValidateConfig } from "../../../src/config/validation";
import type { RawConfig } from "../../../src/config";

function validateToml(toml: string) {
	const rawConfig = TOML.parse(toml) as unknown as RawConfig;
	return normalizeAndValidateConfig(rawConfig, undefined, undefined, {
		env: undefined,
	});
}

describe("dev non-finite port validation", () => {
	it.each(["nan", "+inf", "-inf"])(
		"rejects TOML %s for dev.port",
		(literal) => {
			const { diagnostics } = validateToml(`
				[dev]
				port = ${literal}
			`);

			expect(diagnostics.renderErrors()).toContain(
				'"dev.port" must be a finite number.'
			);
		}
	);

	it.each(["nan", "+inf", "-inf"])(
		"rejects TOML %s for dev.inspector_port",
		(literal) => {
			const { diagnostics } = validateToml(`
				[dev]
				inspector_port = ${literal}
			`);

			expect(diagnostics.renderErrors()).toContain(
				'"dev.inspector_port" must be a finite number.'
			);
		}
	);

	it("preserves ordinary finite dev ports", () => {
		const { diagnostics } = validateToml(`
			[dev]
			port = 8787
			inspector_port = 9229
		`);

		expect(diagnostics.hasErrors()).toBe(false);
	});

	it("preserves the existing wrong-type diagnostic without a finite-number duplicate", () => {
		const { diagnostics } = validateToml(`
			[dev]
			port = "8787"
		`);
		const errors = diagnostics.renderErrors();

		expect(errors).toContain(
			'Expected "dev.port" to be of type number but got "8787".'
		);
		expect(errors).not.toContain('"dev.port" must be a finite number.');
	});
});
