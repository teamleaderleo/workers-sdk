import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { getOauthToken } from "../src/callback-server";
import type { OAuthFlowContext } from "../src/context";

const getAuthURL = vi.hoisted(() => vi.fn());
const isReturningFromAuthServer = vi.hoisted(() => vi.fn());
const exchangeAuthCodeForAccessToken = vi.hoisted(() => vi.fn());

vi.mock("../src/token-exchange", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/token-exchange")>()),
	getAuthURL,
	isReturningFromAuthServer,
	exchangeAuthCodeForAccessToken,
}));

async function getFreePort(): Promise<number> {
	const server = net.createServer();
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Expected an IPv4/IPv6 server address");
	}
	const closed = once(server, "close");
	server.close();
	await closed;
	return address.port;
}

function createContext(): OAuthFlowContext {
	return {
		logger: {
			debug: vi.fn(),
			error: vi.fn(),
			info: vi.fn(),
			log: vi.fn(),
			warn: vi.fn(),
		} as OAuthFlowContext["logger"],
		isNonInteractiveOrCI: () => false,
		openInBrowser: async () => {},
	} as OAuthFlowContext;
}

describe("OAuth callback port ownership", () => {
	beforeEach(() => {
		getAuthURL.mockReset();
		isReturningFromAuthServer.mockReset();
		exchangeAuthCodeForAccessToken.mockReset();
		getAuthURL.mockResolvedValue("https://example.com/authorize");
		isReturningFromAuthServer.mockReturnValue(false);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("rejects a competing listener without disturbing the active attempt", async ({
		expect,
	}) => {
		const port = await getFreePort();
		const createServer = vi.spyOn(http, "createServer");
		const options = {
			browser: false,
			scopes: ["account:read"],
			clientId: "test-client",
			redirectUri: `http://127.0.0.1:${port}/oauth/callback`,
			denied: {
				url: "https://example.com/denied",
				error: "denied",
			},
			granted: { url: "https://example.com/granted" },
			callbackHost: "127.0.0.1",
			callbackPort: port,
		};
		const generators = {
			generateAuthUrl: vi.fn(),
			generateRandomState: vi.fn(),
		} as unknown as Parameters<typeof getOauthToken>[3];

		const first = getOauthToken(options, {}, createContext(), generators);
		await vi.waitFor(() => expect(createServer).toHaveBeenCalledTimes(1));
		const firstServer = createServer.mock.results[0].value as http.Server;
		if (!firstServer.listening) {
			await once(firstServer, "listening");
		}

		const second = getOauthToken(options, {}, createContext(), generators);
		await expect(second).rejects.toThrow("the port is already in use");
		expect(firstServer.listening).toBe(true);

		const response = await fetch(
			`http://127.0.0.1:${port}/oauth/callback`
		);
		expect(response.status).toBe(400);
		await expect(first).rejects.toThrow(
			"did not return an authorisation code"
		);
		await vi.waitFor(() => expect(firstServer.listening).toBe(false));

		const probe = net.createServer();
		probe.listen(port, "127.0.0.1");
		await once(probe, "listening");
		const closed = once(probe, "close");
		probe.close();
		await closed;
	});
});
