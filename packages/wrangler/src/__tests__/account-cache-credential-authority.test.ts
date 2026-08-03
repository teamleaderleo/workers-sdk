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

	it("revalidates a cached account when environment credentials change", async ({
		expect,
	}) => {
		let membershipRequests = 0;
		const accountForRequest = (request: Request) =>
			request.headers.get("Authorization") === "Bearer token-B"
				? { id: "account-B", name: "Account B" }
				: { id: "account-A", name: "Account A" };

		msw.use(
			http.get("*/accounts", ({ request }) =>
				HttpResponse.json(createFetchResult([accountForRequest(request)]))
			),
			http.get("*/memberships", ({ request }) => {
				membershipRequests += 1;
				const account = accountForRequest(request);
				return HttpResponse.json(
					createFetchResult([{ id: `membership-${account.id}`, account }])
				);
			})
		);

		expect(await getOrSelectAccountId({})).toBe("account-A");
		expect(getAccountFromCache()).toEqual({
			id: "account-A",
			name: "Account A",
		});

		vi.stubEnv("CLOUDFLARE_API_TOKEN", "token-B");

		expect(await getOrSelectAccountId({})).toBe("account-B");
		expect(getAccountFromCache()).toEqual({
			id: "account-B",
			name: "Account B",
		});
		expect(membershipRequests).toBe(2);

		expect(await getOrSelectAccountId({})).toBe("account-B");
		expect(membershipRequests).toBe(2);
	});
});
