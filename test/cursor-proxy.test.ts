import { afterEach, describe, expect, it, vi } from "vitest";
import {
	__testUtils,
	assertCursorProxyLocalHttp1,
	isCursorProxyEnabled,
	resolveCursorProxyEnvironment,
	restoreCursorProxyTransport,
} from "../src/cursor-proxy.js";

afterEach(() => {
	restoreCursorProxyTransport();
});

describe("Cursor proxy environment", () => {
	it("prefers PI_PROXY_CURSOR over PI_PROXY and scheme-specific proxies", () => {
		expect(
			resolveCursorProxyEnvironment({
				PI_PROXY: "http://generic.example:8080",
				PI_PROXY_CURSOR: "http://cursor.example:8080",
				HTTP_PROXY: "http://http.example:8080",
				HTTPS_PROXY: "http://https.example:8080",
				NO_PROXY: "localhost,127.0.0.1",
			}),
		).toEqual({
			httpProxy: "http://cursor.example:8080",
			httpsProxy: "http://cursor.example:8080",
			noProxy: "localhost,127.0.0.1",
		});

		expect(
			resolveCursorProxyEnvironment({
				PI_PROXY_CURSOR: "http://cursor.example:8080",
				HTTP_PROXY: "http://http.example:8080",
				HTTPS_PROXY: "http://https.example:8080",
			}),
		).toEqual({
			httpProxy: "http://cursor.example:8080",
			httpsProxy: "http://cursor.example:8080",
		});

		expect(
			resolveCursorProxyEnvironment({
				HTTP_PROXY: "http://http.example:8080",
				HTTPS_PROXY: "http://https.example:8080",
			}),
		).toEqual({
			httpProxy: "http://http.example:8080",
			httpsProxy: "http://https.example:8080",
		});
	});

	it("uses ALL_PROXY as the final fallback", () => {
		expect(resolveCursorProxyEnvironment({ ALL_PROXY: "http://all.example:8080" })).toEqual({
			httpProxy: "http://all.example:8080",
			httpsProxy: "http://all.example:8080",
		});
	});

	it("falls back across HTTP and HTTPS proxy variables", () => {
		expect(resolveCursorProxyEnvironment({ HTTP_PROXY: "http://http.example:8080" })).toEqual({
			httpProxy: "http://http.example:8080",
			httpsProxy: "http://http.example:8080",
		});
		expect(resolveCursorProxyEnvironment({ HTTPS_PROXY: "http://https.example:8080" })).toEqual({
			httpProxy: "http://https.example:8080",
			httpsProxy: "http://https.example:8080",
		});
	});

	it("reads proxy names and NO_PROXY case-insensitively", () => {
		expect(
			resolveCursorProxyEnvironment({
				pI_pRoXy_cUrSoR: " http://cursor.example:8080 ",
				nO_pRoXy: " localhost ",
			}),
		).toEqual({
			httpProxy: "http://cursor.example:8080",
			httpsProxy: "http://cursor.example:8080",
			noProxy: "localhost",
		});
	});

	it("keeps direct transport when only NO_PROXY is set", () => {
		expect(resolveCursorProxyEnvironment({ NO_PROXY: "localhost" })).toEqual({ noProxy: "localhost" });
	});

	it("rejects unsupported proxy URLs without exposing their value", () => {
		expect(() => resolveCursorProxyEnvironment({ PI_PROXY: "ftp://user:secret@example.com:21" })).toThrow(
			"use an http:// or https:// proxy URL",
		);
		expect(() => resolveCursorProxyEnvironment({ PI_PROXY: "ftp://user:secret@example.com:21" })).not.toThrowError(
			/secret|example\.com/,
		);
	});
});

describe("Cursor proxy transport lifecycle", () => {
	it("installs normalized proxy variables and restores the transport", () => {
		const restore = vi.fn();
		const install = vi.fn(() => restore);

		const resolved = __testUtils.installProxyForEnvironment(
			{
				PI_PROXY_CURSOR: "http://cursor.example:8080",
				NO_PROXY: "localhost",
			},
			install,
		);

		expect(resolved).toEqual({
			httpProxy: "http://cursor.example:8080",
			httpsProxy: "http://cursor.example:8080",
			noProxy: "localhost",
		});
		expect(install).toHaveBeenCalledWith({
			HTTP_PROXY: "http://cursor.example:8080",
			HTTPS_PROXY: "http://cursor.example:8080",
			NO_PROXY: "localhost,127.0.0.1,::1",
		});
		expect(isCursorProxyEnabled()).toBe(true);

		restoreCursorProxyTransport();
		expect(restore).toHaveBeenCalledOnce();
		expect(isCursorProxyEnabled()).toBe(false);
	});

	it("does not install a proxy when no proxy variable is configured", () => {
		const install = vi.fn(() => vi.fn());

		__testUtils.installProxyForEnvironment({ NO_PROXY: "localhost" }, install);

		expect(install).not.toHaveBeenCalled();
		expect(isCursorProxyEnabled()).toBe(false);
	});

	it("requires local HTTP/1.1 when a proxy is active", () => {
		__testUtils.installProxyForEnvironment(
			{ PI_PROXY: "http://proxy.example:8080" },
			() => vi.fn(),
		);

		expect(() => assertCursorProxyLocalHttp1(false)).toThrow(
			"requires HTTP/1.1; set PI_CURSOR_HTTP_1_1=true or run /cursor-http on",
		);
		expect(() => assertCursorProxyLocalHttp1(true)).not.toThrow();

		restoreCursorProxyTransport();
	});
});
