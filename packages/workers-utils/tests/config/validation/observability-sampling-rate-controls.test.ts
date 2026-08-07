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

describe("observability sampling-rate controls", () => {
	it.each([0, 1])("accepts boundary sampling rate %s", (samplingRate, { expect }) => {
		const { diagnostics } = validateToml(`
			[observability]
			enabled = true
			head_sampling_rate = ${samplingRate}
		`);

		expect(diagnostics.hasErrors()).toBe(false);
	});

	it.each([-0.1, 1.1])(
		"preserves the range diagnostic for %s",
		(samplingRate, { expect }) => {
			const { diagnostics } = validateToml(`
				[observability]
				enabled = true
				head_sampling_rate = ${samplingRate}
			`);

			expect(diagnostics.renderErrors()).toContain(
				'"observability.head_sampling_rate" must be a value between 0 and 1.'
			);
		}
	);

	it("preserves the type diagnostic without adding a range diagnostic", ({ expect }) => {
		const { diagnostics } = validateToml(`
			[observability]
			enabled = true
			head_sampling_rate = "0.5"
		`);
		const errors = diagnostics.renderErrors();

		expect(errors).toContain(
			'Expected "observability.head_sampling_rate" to be of type number'
		);
		expect(errors).not.toContain(
			'"observability.head_sampling_rate" must be a value between 0 and 1.'
		);
	});
});
