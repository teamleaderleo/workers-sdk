import { describe, test, vi } from "vitest";
import {
	formatPostActivationFailure,
	runPostActivationPhase,
} from "./post-activation-state";

describe("post-activation deployment state reporting", () => {
	test("reports the activation path and version while preserving the original error", async ({
		expect,
	}) => {
		const report = vi.fn();
		const originalError = new Error("container rollout failed");

		let receivedError: unknown;
		try {
			await runPostActivationPhase(
				{
					phase: "container rollout",
					activationMethod: "legacy script upload",
					scriptName: "example-worker",
					versionId: "11111111-1111-1111-1111-111111111111",
					report,
				},
				async () => {
					throw originalError;
				}
			);
		} catch (error) {
			receivedError = error;
		}

		expect(receivedError).toBe(originalError);
		expect(report).toHaveBeenCalledOnce();
		expect(report.mock.calls[0][0]).toContain(
			"deployment failed during container rollout"
		);
		expect(report.mock.calls[0][0]).toContain(
			"Activation method: legacy script upload"
		);
		expect(report.mock.calls[0][0]).toContain(
			"Activated version ID: 11111111-1111-1111-1111-111111111111"
		);
		expect(report.mock.calls[0][0]).toContain(
			"failed phase may also have partially applied"
		);
	});

	test("does not report when the post-activation phase succeeds", async ({
		expect,
	}) => {
		const report = vi.fn();

		await expect(
			runPostActivationPhase(
				{
					phase: "trigger deployment",
					activationMethod: "versions deployment",
					scriptName: "example-worker",
					versionId: "22222222-2222-2222-2222-222222222222",
					report,
				},
				async () => ["example.com/*"]
			)
		).resolves.toEqual(["example.com/*"]);
		expect(report).not.toHaveBeenCalled();
	});

	test("states when the activated version identifier is unavailable", ({
		expect,
	}) => {
		expect(
			formatPostActivationFailure({
				phase: "trigger deployment",
				activationMethod: "legacy script upload",
				scriptName: "legacy-worker",
				versionId: null,
			})
		).toContain("Activated version ID: unavailable from the upload response");
	});
});