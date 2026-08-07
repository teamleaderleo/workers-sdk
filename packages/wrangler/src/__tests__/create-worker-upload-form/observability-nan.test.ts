import { describe, it } from "vitest";
import { createWorkerUploadForm } from "../../deployment-bundle/create-worker-upload-form";
import { createEsmWorker, getMetadata } from "./helpers";

describe("createWorkerUploadForm — observability NaN", () => {
	it("serializes a NaN sampling rate as null in worker metadata", ({ expect }) => {
		const form = createWorkerUploadForm(
			createEsmWorker({
				observability: {
					enabled: true,
					head_sampling_rate: Number.NaN,
				},
			}),
			{}
		);

		expect(getMetadata(form).observability).toEqual({
			enabled: true,
			head_sampling_rate: null,
		});
	});
});
