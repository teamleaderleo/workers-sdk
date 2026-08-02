import { runInTempDir } from "@cloudflare/workers-utils/test-helpers";
import { describe, it, vi } from "vitest";
import { saveToConfigCache } from "../config-cache";
import { getOrSelectAccountId } from "../user";
import { msw } from "./helpers/msw";
import { getMswSuccessMembershipHandlers } from "./helpers/msw/handlers/user";

describe("account cache authority", () => {
	runInTempDir();

	it("revalidates a cached account under the active environment credential", async ({
		expect,
	}) => {
		vi.stubEnv("CLOUDFLARE_API_TOKEN", "credential-B");
		saveToConfigCache("wrangler-account.json", {
			account: { id: "account-A", name: "Account A" },
		});
		msw.use(
			...getMswSuccessMembershipHandlers([
				{ id: "account-B", name: "Account B" },
			])
		);

		await expect(getOrSelectAccountId({})).resolves.toBe("account-B");
	});
});
