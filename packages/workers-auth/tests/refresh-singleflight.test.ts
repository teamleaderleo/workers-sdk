import { beforeEach, describe, it, vi } from "vitest";
import { createOAuthFlow } from "../src/flow";
import type {
	AuthConfigStorage,
	UserAuthConfig,
} from "../src/config-file/auth";
import type { OAuthFlowContext } from "../src/context";

const exchangeRefreshTokenForAccessToken = vi.hoisted(() => vi.fn());

vi.mock("../src/token-exchange", () => ({
	exchangeRefreshTokenForAccessToken,
}));

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
		path: () => "memory-profile-A",
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

function createExpiredFlow() {
	const storage = createStorage({
		oauth_token: "expired-access-token",
		expiration_time: "2000-01-01T00:00:00.000Z",
		refresh_token: "refresh-token-R0",
		scopes: ["account:read"],
	});

	return createOAuthFlow({
		logger: createLogger(),
		isNonInteractiveOrCI: () => true,
		openInBrowser: async () => {},
		hasEnvCredentials: () => false,
		clientId: "test-client",
		consent: {
			granted: { url: "https://example.com/granted" },
			denied: { url: "https://example.com/denied", error: "denied" },
		},
		redirectUri: "http://localhost:8976/oauth/callback",
		storageFactory: () => storage,
		allowGlobalAuthKey: false,
	});
}

const loginProps = {
	complianceConfig: {},
	scopes: ["account:read"],
};

describe("OAuth refresh single-flight", () => {
	beforeEach(() => {
		exchangeRefreshTokenForAccessToken.mockReset();
	});

	it("shares one refresh across concurrent callers", async ({ expect }) => {
		const flow = createExpiredFlow();
		const { promise: gate, resolve: releaseRefresh } =
			Promise.withResolvers<void>();

		exchangeRefreshTokenForAccessToken.mockImplementation(async () => {
			await gate;
			return {
				token: {
					value: "refreshed-access-token",
					expiry: "2999-01-01T00:00:00.000Z",
				},
				refreshToken: { value: "refresh-token-R1" },
				scopes: ["account:read"],
			};
		});

		const first = flow.loginOrRefreshIfRequired(loginProps);
		const second = flow.loginOrRefreshIfRequired(loginProps);
		releaseRefresh();

		await expect(Promise.all([first, second])).resolves.toEqual([
			{ loggedIn: true },
			{ loggedIn: true },
		]);
		expect(exchangeRefreshTokenForAccessToken).toHaveBeenCalledTimes(1);
	});

	it("clears a failed single-flight entry for a later retry", async ({
		expect,
	}) => {
		const flow = createExpiredFlow();
		exchangeRefreshTokenForAccessToken.mockRejectedValueOnce(
			new Error("refresh failed")
		);

		await expect(
			Promise.all([
				flow.loginOrRefreshIfRequired(loginProps),
				flow.loginOrRefreshIfRequired(loginProps),
			])
		).resolves.toEqual([
			{ loggedIn: false, reason: "token-expired-non-interactive" },
			{ loggedIn: false, reason: "token-expired-non-interactive" },
		]);
		expect(exchangeRefreshTokenForAccessToken).toHaveBeenCalledTimes(1);

		exchangeRefreshTokenForAccessToken.mockResolvedValueOnce({
			token: {
				value: "refreshed-access-token",
				expiry: "2999-01-01T00:00:00.000Z",
			},
			refreshToken: { value: "refresh-token-R1" },
			scopes: ["account:read"],
		});

		await expect(flow.loginOrRefreshIfRequired(loginProps)).resolves.toEqual({
			loggedIn: true,
		});
		expect(exchangeRefreshTokenForAccessToken).toHaveBeenCalledTimes(2);
	});
});
