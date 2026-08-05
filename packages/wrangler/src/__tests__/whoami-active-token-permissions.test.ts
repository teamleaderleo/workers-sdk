import { COMPLIANCE_REGION_CONFIG_UNKNOWN } from "@cloudflare/workers-utils";
import { runInTempDir } from "@cloudflare/workers-utils/test-helpers";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { writeAuthCredentials } from "../user";
import { getUserInfo } from "../user/whoami";
import {
	createFetchResult,
	msw,
	mswSuccessOauthHandlers,
	mswSuccessUserHandlers,
} from "./helpers/msw";

describe("whoami active token permissions", () => {
	runInTempDir();

	beforeEach(() => {
		msw.use(...mswSuccessOauthHandlers, ...mswSuccessUserHandlers);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("does not attach stored OAuth scopes to an environment user API token", async ({
		expect,
	}) => {
		writeAuthCredentials({
			oauth_token: "inactive-oauth-token",
			expiration_time: "2999-01-01T00:00:00.000Z",
			scopes: ["workers:write"],
		});
		vi.stubEnv("CLOUDFLARE_API_TOKEN", "active-api-token");
		msw.use(
			http.get("*/user/tokens/verify", () =>
				HttpResponse.json(createFetchResult({ id: "active-token-id" }))
			)
		);

		const userInfo = await getUserInfo(COMPLIANCE_REGION_CONFIG_UNKNOWN);

		expect(userInfo?.authType).toBe("User API Token");
		expect(userInfo?.tokenPermissions).toBeUndefined();
	});

	it("does not attach stored OAuth scopes to an environment account API token", async ({
		expect,
	}) => {
		writeAuthCredentials({
			oauth_token: "inactive-oauth-token",
			expiration_time: "2999-01-01T00:00:00.000Z",
			scopes: ["workers:write"],
		});
		vi.stubEnv("CLOUDFLARE_API_TOKEN", "active-account-token");
		msw.use(
			http.get("*/user/tokens/verify", () =>
				HttpResponse.json(
					createFetchResult({}, false, [
						{ code: 1000, message: "Invalid API Token" },
					])
				)
			)
		);

		const userInfo = await getUserInfo(COMPLIANCE_REGION_CONFIG_UNKNOWN);

		expect(userInfo?.authType).toBe("Account API Token");
		expect(userInfo?.tokenPermissions).toBeUndefined();
	});

	it("does not attach stored OAuth scopes to an active global API key", async ({
		expect,
	}) => {
		writeAuthCredentials({
			oauth_token: "inactive-oauth-token",
			expiration_time: "2999-01-01T00:00:00.000Z",
			scopes: ["workers:write"],
		});
		vi.stubEnv("CLOUDFLARE_API_KEY", "active-global-key");
		vi.stubEnv("CLOUDFLARE_EMAIL", "user@example.com");

		const userInfo = await getUserInfo(COMPLIANCE_REGION_CONFIG_UNKNOWN);

		expect(userInfo?.authType).toBe("Global API Key");
		expect(userInfo?.tokenPermissions).toBeUndefined();
	});

	it("still returns scopes for the active OAuth token", async ({ expect }) => {
		writeAuthCredentials({
			oauth_token: "active-oauth-token",
			expiration_time: "2999-01-01T00:00:00.000Z",
			scopes: ["workers:write"],
		});

		const userInfo = await getUserInfo(COMPLIANCE_REGION_CONFIG_UNKNOWN);

		expect(userInfo?.authType).toBe("OAuth Token");
		expect(userInfo?.tokenPermissions).toEqual(["workers:write"]);
	});
});
