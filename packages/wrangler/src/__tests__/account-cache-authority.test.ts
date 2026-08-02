import { http, HttpResponse } from "msw";
import { afterEach, describe, it, vi } from "vitest";
import { runInTempDir } from "@cloudflare/workers-utils/test-helpers";
import { saveToConfigCache } from "../config-cache";
import { getOrSelectAccountId } from "../user";
import { msw } from "./helpers/msw";

const emptyAccountResponse = {
	success: true,
	errors: [],
	messages: [],
	result: [],
	result_info: {
		page: 1,
		per_page: 20,
		count: 0,
		total_count: 0,
		total_pages: 0,
	},
};

describe("cached account authority", () => {
	runInTempDir();

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("returns a cached account without validating changed environment credentials", async ({
		expect,
	}) => {
		vi.stubEnv("CLOUDFLARE_API_TOKEN", "fieldwork-credential-b");
		saveToConfigCache("wrangler-account.json", {
			account: { id: "account-a", name: "Account A" },
		});

		let accountAuthorityRequests = 0;
		msw.use(
			http.get("*/memberships", () => {
				accountAuthorityRequests += 1;
				return HttpResponse.json(emptyAccountResponse);
			}),
			http.get("*/accounts", () => {
				accountAuthorityRequests += 1;
				return HttpResponse.json(emptyAccountResponse);
			})
		);

		await expect(getOrSelectAccountId({})).resolves.toBe("account-a");
		expect(accountAuthorityRequests).toBe(0);
	});
});
