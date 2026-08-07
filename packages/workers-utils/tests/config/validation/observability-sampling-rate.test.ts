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

describe("observability sampling-rate validation", () => {
	it("rejects a TOML NaN top-level sampling rate", ({ expect }) => {
		const { config, diagnostics } = validateToml(`
			[observability]
			enabled = true
			head_sampling_rate = nan
		`);

		expect(Number.isNaN(config.observability?.head_sampling_rate)).toBe(true);
		expect(diagnostics.renderErrors()).toContain(
			'"observability.head_sampling_rate" must be a value between 0 and 1.'
		);
	});

	it("rejects a TOML NaN logs sampling rate", ({ expect }) => {
		const { config, diagnostics } = validateToml(`
			[observability.logs]
			enabled = true
			head_sampling_rate = nan
		`);

		expect(Number.isNaN(config.observability?.logs?.head_sampling_rate)).toBe(
			true
		);
		expect(diagnostics.renderErrors()).toContain(
			'"observability.logs.head_sampling_rate" must be a value between 0 and 1.'
		);
	});

	it("rejects a TOML NaN traces sampling rate", ({ expect }) => {
		const { config, diagnostics } = validateToml(`
			[observability.traces]
			enabled = true
			head_sampling_rate = nan
		`);

		expect(Number.isNaN(config.observability?.traces?.head_sampling_rate)).toBe(
			true
		);
		expect(diagnostics.renderErrors()).toContain(
			'"observability.traces.head_sampling_rate" must be a value between 0 and 1.'
		);
	});
});
