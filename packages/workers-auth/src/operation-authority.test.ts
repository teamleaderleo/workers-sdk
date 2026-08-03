import { describe, it, vi } from "vitest";
import { createOAuthFlow } from "./flow";
import type {
	AuthConfigStorage,
	UserAuthConfig,
} from "./config-file/auth";
import type {
	TemporaryAccountStorage,
	TemporaryPreviewAccount,
} from "./config-file/temporary";
import type { OAuthFlowContext } from "./context";

function createStorage(initial: UserAuthConfig): AuthConfigStorage {
	let value: UserAuthConfig | undefined = initial;
	return {
		read: () => value,
		write: (next) => {
			value = next;
		},
		clear: () => {
			const existed = value !== undefined;
			value = undefined;
			return existed;
		},
		path: () => "memory-auth",
	};
}

function createTemporaryStorage(
	initial: TemporaryPreviewAccount
): TemporaryAccountStorage {
	let value: TemporaryPreviewAccount | undefined = initial;
	return {
		read: () => value,
		write: (next) => {
			value = next;
		},
		clear: () => {
			const existed = value !== undefined;
			value = undefined;
			return existed;
		},
		path: () => "memory-temporary",
	};
}

function createLogger(): OAuthFlowContext["logger"] {
	return {
		debug: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	} as unknown as OAuthFlowContext["logger"];
}

function getStorage(
	stores: Map<string, AuthConfigStorage>,
	profile = "default"
): AuthConfigStorage {
	const storage = stores.get(profile);
	if (!storage) {
		throw new Error(`Missing test storage for ${profile}`);
	}
	return storage;
}

function createTestFlow(options?: {
	temporaryStorage?: TemporaryAccountStorage;
}) {
	const stores = new Map<string, AuthConfigStorage>([
		[
			"profile-A",
			createStorage({
				oauth_token: "token-A",
				expiration_time: "2999-01-01T00:00:00.000Z",
			}),
		],
		[
			"profile-B",
			createStorage({
				oauth_token: "token-B",
				expiration_time: "2999-01-01T00:00:00.000Z",
			}),
		],
	]);

	return createOAuthFlow({
		logger: createLogger(),
		isNonInteractiveOrCI: () => true,
		openInBrowser: async () => {},
		hasEnvCredentials: () => false,
		clientId: "test-client",
		consent: {
			granted: { url: "https://example.com/granted" },
			denied: {
				url: "https://example.com/denied",
				error: "denied",
			},
		},
		redirectUri: "http://localhost:8976/oauth/callback",
		storageFactory: (profile) => getStorage(stores, profile),
		allowGlobalAuthKey: false,
		temporary: options?.temporaryStorage
			? {
					storage: options.temporaryStorage,
					prompt: async () => true,
				}
			: undefined,
	});
}

describe("OAuth flow operation authority", () => {
	it("keeps a pending operation bound to its starting profile", async ({
		expect,
	}) => {
		const flow = createTestFlow();
		const { promise: gate, resolve: releaseOperation } =
			Promise.withResolvers<void>();

		flow.setProfile("profile-A");
		const pending = (async () => {
			expect(flow.requireApiToken()).toEqual({ apiToken: "token-A" });
			await gate;
			return flow.requireApiToken();
		})();

		flow.setProfile("profile-B");
		releaseOperation();

		await expect(pending).resolves.toEqual({ apiToken: "token-A" });
	});

	it("keeps a pending temporary operation bound to its temporary account", async ({
		expect,
	}) => {
		const temporaryAccount: TemporaryPreviewAccount = {
			account: {
				id: "temporary-account-A",
				name: "Temporary A",
				apiToken: "temporary-token-A",
				expiresAt: "2999-01-01T00:00:00.000Z",
			},
			claim: {
				url: "https://example.com/claim",
				expiresAt: "2999-01-01T00:00:00.000Z",
			},
		};
		const flow = createTestFlow({
			temporaryStorage: createTemporaryStorage(temporaryAccount),
		});
		const { promise: gate, resolve: releaseOperation } =
			Promise.withResolvers<void>();

		flow.setProfile("profile-A");
		flow.setTemporaryAllowed(true);
		await flow.activateTemporaryAccount();
		const pending = (async () => {
			expect(flow.requireApiToken()).toEqual({
				apiToken: "temporary-token-A",
			});
			await gate;
			return flow.requireApiToken();
		})();

		flow.setTemporaryAllowed(false);
		releaseOperation();

		await expect(pending).resolves.toEqual({
			apiToken: "temporary-token-A",
		});
	});
});
