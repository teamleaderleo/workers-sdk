import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	it,
} from "vitest";
import { clearAccessCaches, domainUsesAccess } from "../src/access";

const msw = setupServer();

const silentLogger = {
	debug: () => {},
	info: () => {},
	log: () => {},
	warn: () => {},
	error: () => {},
};

beforeAll(() => msw.listen({ onUnhandledRequest: "error" }));
beforeEach(() => clearAccessCaches());
afterEach(() => msw.resetHandlers());
afterAll(() => msw.close());

describe("Access detection cache", () => {
	it("retries after a transient probe failure", async ({ expect }) => {
		let probes = 0;
		msw.use(
			http.get("https://access-probe-retry.com/", () => {
				probes += 1;
				if (probes === 1) {
					return HttpResponse.error();
				}
				return HttpResponse.json(null, {
					status: 302,
					headers: {
						location:
							"https://access-probe-retry.cloudflareaccess.com/cdn-cgi/access/login",
					},
				});
			})
		);

		await expect(
			domainUsesAccess("access-probe-retry.com", silentLogger)
		).resolves.toBe(false);
		await expect(
			domainUsesAccess("access-probe-retry.com", silentLogger)
		).resolves.toBe(true);
		expect(probes).toBe(2);
	});

	it("continues caching definitive negative probes", async ({ expect }) => {
		let probes = 0;
		msw.use(
			http.get("https://access-probe-negative.com/", () => {
				probes += 1;
				return HttpResponse.json("OK", { status: 200 });
			})
		);

		await expect(
			domainUsesAccess("access-probe-negative.com", silentLogger)
		).resolves.toBe(false);
		await expect(
			domainUsesAccess("access-probe-negative.com", silentLogger)
		).resolves.toBe(false);
		expect(probes).toBe(1);
	});

	it("continues caching definitive Access-positive probes", async ({ expect }) => {
		let probes = 0;
		msw.use(
			http.get("https://access-probe-positive.com/", () => {
				probes += 1;
				return HttpResponse.json(null, {
					status: 302,
					headers: {
						location:
							"https://access-probe-positive.cloudflareaccess.com/cdn-cgi/access/login",
					},
				});
			})
		);

		await expect(
			domainUsesAccess("access-probe-positive.com", silentLogger)
		).resolves.toBe(true);
		await expect(
			domainUsesAccess("access-probe-positive.com", silentLogger)
		).resolves.toBe(true);
		expect(probes).toBe(1);
	});
});
