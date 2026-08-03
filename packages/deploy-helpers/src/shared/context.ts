import { AsyncLocalStorage } from "node:async_hooks";
import type { DeployHelpersContext } from "./types";
import type {
	FetchKVGetValueFetcher,
	FetchListResultFetcher,
	FetchPagedListResultFetcher,
	FetchResultFetcher,
	Logger,
} from "@cloudflare/workers-utils";

const contextStorage = new AsyncLocalStorage<DeployHelpersContext>();
let fallbackContext: DeployHelpersContext | undefined;

function getDeployHelpersContext(): DeployHelpersContext {
	const context = contextStorage.getStore() ?? fallbackContext;
	if (!context) {
		throw new Error(
			"Deploy helpers context must be initialized before it is used."
		);
	}
	return context;
}

type FunctionContextKey =
	| "fetchResult"
	| "fetchListResult"
	| "fetchPagedListResult"
	| "fetchKVGetValue"
	| "confirm"
	| "prompt"
	| "select";

function forwardFunction<Key extends FunctionContextKey>(
	key: Key
): DeployHelpersContext[Key] {
	return ((...args: unknown[]) => {
		const fn = getDeployHelpersContext()[key] as (
			...args: unknown[]
		) => unknown;
		return fn(...args);
	}) as DeployHelpersContext[Key];
}

/**
 * Forwarding adapters for the active deploy-helper operation.
 *
 * `initDeployHelpersContext()` installs a context in the current async chain.
 * Operations that start before another initialization retain their own owner,
 * while sequential callers keep the existing initializer-based API.
 */
export const logger: Logger = new Proxy({} as Logger, {
	get(_target, property) {
		const currentLogger = getDeployHelpersContext().logger;
		const value = Reflect.get(currentLogger, property, currentLogger) as unknown;
		return typeof value === "function" ? value.bind(currentLogger) : value;
	},
});
export const fetchResult: FetchResultFetcher = forwardFunction("fetchResult");
export const fetchListResult: FetchListResultFetcher =
	forwardFunction("fetchListResult");
export const fetchPagedListResult: FetchPagedListResultFetcher = forwardFunction(
	"fetchPagedListResult"
);
export const fetchKVGetValue: FetchKVGetValueFetcher =
	forwardFunction("fetchKVGetValue");
export const confirm: DeployHelpersContext["confirm"] =
	forwardFunction("confirm");
export const prompt: DeployHelpersContext["prompt"] = forwardFunction("prompt");
export const select: DeployHelpersContext["select"] = forwardFunction("select");

/**
 * Set the deploy-helper context for the current async operation.
 *
 * The fallback preserves existing sequential and module-initialization callers.
 * AsyncLocalStorage keeps already-started overlapping operations bound to the
 * context active when their asynchronous work was created.
 */
export function initDeployHelpersContext(ctx: DeployHelpersContext): void {
	fallbackContext = ctx;
	contextStorage.enterWith(ctx);
}
