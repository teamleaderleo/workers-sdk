import { runInTempDir } from "@cloudflare/workers-utils/test-helpers";
import { describe, it, vi } from "vitest";
import { getAccountFromCache, getOrSelectAccountId } from "../user";
import {
	getMswSuccessMembershipHandlers,
	msw,
} from "./helpers/msw";

describe("account cache authority", () => {
	runInTempDir();

	it("revalidates a cached account after environment credentials change", async ({
		expect,
	}) => {
		vi.stubEnv("CLOUDFLARE_API_TOKEN", "sentinel-token-a");
		msw.use(
			...getMswSuccessMembershipHandlers([
				{ id: "account-a", name: "Account A" },
			])
		);

		expect(await getOrSelectAccountId({})).toBe("account-a");
		expect(getAccountFromCache()).toEqual({
			id: "account-a",
			name: "Account A",
		});

		vi.stubEnv("CLOUDFLARE_API_TOKEN", "sentinel-token-b");
		msw.use(
			...getMswSuccessMembershipHandlers([
				{ id: "account-b", name: "Account B" },
			])
		);

		expect(await getOrSelectAccountId({})).toBe("account-b");
	});
});
