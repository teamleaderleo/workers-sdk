import { setupServer } from "msw/node";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	it,
	vi,
} from "vitest";
import { clearAccessCaches, getAccessHeaders } from "../src/access";
import { mswAccessHandlers } from "../src/test-helpers/msw-handlers/access";

const msw = setupServer(...mswAccessHandlers);

const silentLogger = {
	debug: () => {},
	info: () => {},
	log: () => {},
	warn: vi.fn(),
	error: () => {},
};

const options = {
	logger: silentLogger,
	isNonInteractiveOrCI: () => true,
};

beforeAll(() => msw.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
	clearAccessCaches();
	silentLogger.warn = vi.fn();
});
afterEach(() => {
	vi.unstubAllEnvs();
	msw.resetHandlers();
});
afterAll(() => msw.close());

describe("Access cache authority", () => {
	it("does not reuse cached service-token headers after current credentials are removed", async ({
		expect,
	}) => {
		vi.stubEnv("CLOUDFLARE_ACCESS_CLIENT_ID", "sentinel-client-A");
		vi.stubEnv("CLOUDFLARE_ACCESS_CLIENT_SECRET", "sentinel-secret-A");

		await expect(
			getAccessHeaders("access-protected.com", options)
		).resolves.toEqual({
			"CF-Access-Client-Id": "sentinel-client-A",
			"CF-Access-Client-Secret": "sentinel-secret-A",
		});

		vi.unstubAllEnvs();

		await expect(
			getAccessHeaders("access-protected.com", options)
		).rejects.toThrow("no Access Service Token credentials were found");
	});

	it("does not replace a partial current pair with a cached complete pair", async ({
		expect,
	}) => {
		vi.stubEnv("CLOUDFLARE_ACCESS_CLIENT_ID", "sentinel-client-A");
		vi.stubEnv("CLOUDFLARE_ACCESS_CLIENT_SECRET", "sentinel-secret-A");
		await getAccessHeaders("access-protected.com", options);

		vi.unstubAllEnvs();
		vi.stubEnv("CLOUDFLARE_ACCESS_CLIENT_ID", "sentinel-client-B");

		await expect(
			getAccessHeaders("access-protected.com", options)
		).rejects.toThrow("no Access Service Token credentials were found");
		expect(silentLogger.warn).toHaveBeenCalledWith(
			expect.stringContaining(
				"Only CLOUDFLARE_ACCESS_CLIENT_ID was found"
			)
		);
	});
});
