import { runInTempDir } from "@cloudflare/workers-utils/test-helpers";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, it, vi } from "vitest";
import { getAccountFromCache, getOrSelectAccountId } from "../user";
import { createFetchResult, msw } from "./helpers/msw";

describe("account cache credential authority", () => {
	runInTempDir();

	beforeEach(() => {
		vi.stubEnv("CLOUDFLARE_API_TOKEN", "token-A");
	});

	it("reuses an account cached under a previous environment token", async ({
		expect,
	}) => {
		let membershipRequests = 0;
		msw.use(
			http.get("*/memberships", () => {
				membershipRequests += 1;
				const account =
					membershipRequests === 1
						? { id: "account-A", name: "Account A" }
						: { id: "account-B", name: "Account B" };

				return HttpResponse.json(
					createFetchResult([
						{
							id: `membership-${membershipRequests}`,
							account,
						},
					])
				);
			})
		);

		expect(await getOrSelectAccountId({})).toBe("account-A");
		expect(getAccountFromCache()).toEqual({
			id: "account-A",
			name: "Account A",
		});

		vi.stubEnv("CLOUDFLARE_API_TOKEN", "token-B");

		// Current behavior: the profile-scoped cache is returned before the
		// accounts available to token B are queried.
		expect(await getOrSelectAccountId({})).toBe("account-A");
		expect(membershipRequests).toBe(1);
	});
});
