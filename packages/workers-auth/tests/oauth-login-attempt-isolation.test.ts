import { beforeEach, describe, it, vi } from "vitest";
import { createOAuthFlow } from "../src/flow";
import type {
	AuthConfigStorage,
	UserAuthConfig,
} from "../src/config-file/auth";
import type { OAuthFlowContext } from "../src/context";
import type { OAuthFlowState } from "../src/state";

const getOauthToken = vi.hoisted(() => vi.fn());

vi.mock("../src/callback-server", () => ({ getOauthToken }));

function createStorage(): AuthConfigStorage {
	let value: UserAuthConfig | undefined;
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
		path: () => "memory-login-profile",
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

describe("OAuth login attempt isolation", () => {
	beforeEach(() => {
		getOauthToken.mockReset();
	});

	it("gives concurrent login attempts distinct PKCE and CSRF state", async ({
		expect,
	}) => {
		const stores = new Map([
			["profile-A", createStorage()],
			["profile-B", createStorage()],
		]);
		const states: OAuthFlowState[] = [];
		const { promise: gate, resolve: releaseLogins } =
			Promise.withResolvers<void>();

		getOauthToken.mockImplementation(
			async (_options: unknown, state: OAuthFlowState) => {
				states.push(state);
				await gate;
				return {
					token: {
						value: `access-${states.length}`,
						expiry: "2999-01-01T00:00:00.000Z",
					},
					refreshToken: { value: `refresh-${states.length}` },
					scopes: ["account:read"],
				};
			}
		);

		const flow = createOAuthFlow({
			logger: createLogger(),
			isNonInteractiveOrCI: () => false,
			openInBrowser: async () => {},
			hasEnvCredentials: () => false,
			clientId: "test-client",
			consent: {
				granted: { url: "https://example.com/granted" },
				denied: { url: "https://example.com/denied", error: "denied" },
			},
			redirectUri: "http://localhost:8976/oauth/callback",
			storageFactory: (profile = "profile-A") => {
				const storage = stores.get(profile);
				if (!storage) {
					throw new Error(`Missing storage for ${profile}`);
				}
				return storage;
			},
			allowGlobalAuthKey: false,
		});

		const first = flow.login({
			complianceConfig: {},
			scopes: ["account:read"],
			profile: "profile-A",
		});
		const second = flow.login({
			complianceConfig: {},
			scopes: ["account:read"],
			profile: "profile-B",
		});

		await vi.waitFor(() => expect(states).toHaveLength(2));
		expect(states[0]).not.toBe(states[1]);

		releaseLogins();
		await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
	});
});
