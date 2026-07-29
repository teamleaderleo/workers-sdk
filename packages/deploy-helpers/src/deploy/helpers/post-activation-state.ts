export type PostActivationPhase = "container rollout" | "trigger deployment";

export type ActivationMethod =
	| "versions deployment"
	| "legacy script upload";

export type PostActivationContext = {
	phase: PostActivationPhase;
	activationMethod: ActivationMethod;
	scriptName: string;
	versionId: string | null;
	report: (message: string) => void;
};

export function formatPostActivationFailure({
	phase,
	activationMethod,
	scriptName,
	versionId,
}: Omit<PostActivationContext, "report">): string {
	const versionLine = versionId
		? `Activated version ID: ${versionId}`
		: "Activated version ID: unavailable from the upload response";

	return [
		`Worker activation completed for ${scriptName}, but deployment failed during ${phase}.`,
		`Activation method: ${activationMethod}.`,
		versionLine,
		"The Worker may already be serving the new code, and the failed phase may also have partially applied.",
		"Inspect current deployment state before retrying or rolling back.",
	].join("\n");
}

/**
 * Runs a deployment phase that occurs after Worker code activation.
 *
 * The original error is deliberately rethrown unchanged. This helper adds a
 * visible state receipt without changing APIError/UserError identity,
 * telemetry classification, or retry behaviour.
 */
export async function runPostActivationPhase<T>(
	context: PostActivationContext,
	operation: () => Promise<T>
): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		context.report(formatPostActivationFailure(context));
		throw error;
	}
}