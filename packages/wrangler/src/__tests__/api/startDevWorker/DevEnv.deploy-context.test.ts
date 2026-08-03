import {
	getWorkersDevSubdomain,
	initDeployHelpersContext,
} from "@cloudflare/deploy-helpers";
import { describe, it, vi } from "vitest";
import { DevEnv } from "../../../api/startDevWorker/DevEnv";
import { RuntimeController } from "../../../api/startDevWorker/BaseController";
import type {
	BundleCompleteEvent,
	BundleStartEvent,
	PreviewTokenExpiredEvent,
} from "../../../api/startDevWorker/events";
import type { ControllerBus } from "../../../api/startDevWorker/BaseController";
import type { Miniflare } from "miniflare";

class ProbeRuntimeController extends RuntimeController {
	pendingSubdomain: Promise<string> | undefined;

	constructor(
		bus: ControllerBus,
		private readonly accountId: string
	) {
		super(bus);
	}

	onBundleStart(_: BundleStartEvent): void {}
	onBundleComplete(_: BundleCompleteEvent): void {}

	onPreviewTokenExpired(_: PreviewTokenExpiredEvent): void {
		this.pendingSubdomain = getWorkersDevSubdomain({}, this.accountId);
	}

	get mf(): Miniflare | undefined {
		return undefined;
	}
}

function installContext(label: string, events: string[]): void {
	initDeployHelpersContext({
		logger: {
			debug: vi.fn(),
			error: vi.fn(),
			info: vi.fn(),
			log: vi.fn(),
			warn: vi.fn(),
		} as never,
		fetchResult: (async () => {
			events.push(`fetch-${label}`);
			return { subdomain: label.toLowerCase() };
		}) as never,
		fetchListResult: vi.fn() as never,
		fetchPagedListResult: vi.fn() as never,
		fetchKVGetValue: vi.fn() as never,
		confirm: vi.fn() as never,
		prompt: vi.fn() as never,
		select: vi.fn() as never,
	});
}

describe("DevEnv deploy-helper instance ownership", () => {
	it("keeps a later event on the context active when the instance was created", async ({
		expect,
	}) => {
		const events: string[] = [];
		let runtimeA: ProbeRuntimeController | undefined;
		let runtimeB: ProbeRuntimeController | undefined;

		installContext("A", events);
		const devEnvA = new DevEnv({
			runtimeFactories: [
				(bus) => {
					runtimeA = new ProbeRuntimeController(bus, "account-A");
					return runtimeA;
				},
			],
		});

		installContext("B", events);
		const devEnvB = new DevEnv({
			runtimeFactories: [
				(bus) => {
					runtimeB = new ProbeRuntimeController(bus, "account-B");
					return runtimeB;
				},
			],
		});

		devEnvA.dispatch({
			type: "previewTokenExpired",
			proxyData: {} as never,
		});

		if (!runtimeA?.pendingSubdomain || !runtimeB) {
			throw new Error("Probe runtimes were not created");
		}
		await expect(runtimeA.pendingSubdomain).resolves.toBe("a.workers.dev");
		expect(events).toEqual(["fetch-A"]);

		await Promise.all([devEnvA.teardown(), devEnvB.teardown()]);
	});
});
