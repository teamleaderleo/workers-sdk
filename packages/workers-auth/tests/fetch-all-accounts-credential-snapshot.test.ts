import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { createCloudflareAuth } from "../src/core/factory";
import type { AuthContext, CliDescriptor } from "../src/core/types";

const fetchInternalBase = vi.hoisted(() => vi.fn());

vi.mock("@cloudflare/workers-utils", async (importOriginal) => ({
	...(await importOriginal<typeof import("@cloudflare/workers-utils")>()),
	fetchInternalBase,
}));

function createLogger(): AuthContext["logger"] {
	return {
		debug: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	} as unknown as AuthContext["logger"];
}

describe("fetchAllAccounts credential ownership", () => {
	let configDir: string;
	let originalApiToken: string | undefined;

	beforeEach(() => {
		configDir = mkdtempSync(join(tmpdir(), "workers-auth-snapshot-"));
		originalApiToken = process.env.CLOUDFLARE_API_TOKEN;
		process.env.CLOUDFLARE_API_TOKEN = "active-environment-token";
		delete process.env.CLOUDFLARE_API_KEY;
		delete process.env.CLOUDFLARE_EMAIL;
		fetchInternalBase.mockReset();
	});

	afterEach(() => {
		if (originalApiToken === undefined) {
			delete process.env.CLOUDFLARE_API_TOKEN;
		} else {
			process.env.CLOUDFLARE_API_TOKEN = originalApiToken;
		}
		rmSync(configDir, { recursive: true, force: true });
	});

	it("passes one captured credential object to accounts and memberships", async ({
		expect,
	}) => {
		const account = { id: "account-1", name: "Account One" };
		const credentials: unknown[] = [];
		fetchInternalBase.mockImplementation(async (...args: unknown[]) => {
			const resource = args[1];
			credentials.push(args[7]);
			return {
				response: {
					success: true,
					result:
						resource === "/accounts" ? [account] : [{ account }],
					errors: [],
					result_info: {
						page: 1,
						per_page: 50,
						count: 1,
						total_count: 1,
					},
				},
				status: 200,
			};
		});

		const descriptor: CliDescriptor = {
			cliName: "test-cli",
			commands: {
				login: "test login",
				whoami: "test whoami",
				createProfile: "test auth create",
			},
			keyringServiceName: "test-workers-auth",
			clientId: "test-client",
			consent: {
				granted: { url: "https://example.com/granted" },
				denied: { url: "https://example.com/denied", error: "denied" },
			},
			redirectUri: "http://localhost:8976/oauth/callback",
			getConfigPath: () => configDir,
			getTemporaryAccountConfigPath: () =>
				join(configDir, "temporary-account.json"),
			fileFormat: "json",
			accountCachePrefix: "test-account",
			cacheNamespace: "test-credential-snapshot",
			getConfigFileLabel: () => "test config",
			getDefaultScopeKeys: () => ["account:read"],
		};
		const context: AuthContext = {
			logger: createLogger(),
			userAgent: "test/1.0.0",
			prompt: async () => "yes",
			select: async () => account.id,
			isNoDefaultValueProvidedError: () => false,
		};

		const auth = createCloudflareAuth(descriptor, context);
		await expect(auth.fetchAllAccounts({})).resolves.toEqual([account]);

		expect(fetchInternalBase).toHaveBeenCalledTimes(2);
		expect(credentials).toHaveLength(2);
		expect(credentials[0]).toBeDefined();
		expect(credentials[0]).toBe(credentials[1]);
	});
});
