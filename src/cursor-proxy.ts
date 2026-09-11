import * as http from "node:http";

export interface CursorProxyEnvironment {
	httpProxy?: string;
	httpsProxy?: string;
	noProxy?: string;
}

type GlobalProxyInstaller = (proxyEnv: Record<string, string>) => () => void;

type SelectedProxy = {
	value?: string;
	name?: string;
};

type NodeHttpWithGlobalProxy = typeof http & {
	setGlobalProxyFromEnv?: GlobalProxyInstaller;
};

const nodeHttp = http as NodeHttpWithGlobalProxy;
let activeProxyEnvironment: CursorProxyEnvironment | undefined;
let restoreGlobalProxy: (() => void) | undefined;

function readNonEmptyEnvironmentValue(env: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
	const exact = env[name];
	if (typeof exact === "string" && exact.trim()) return exact.trim();

	const upperName = name.toUpperCase();
	for (const [key, value] of Object.entries(env)) {
		if (key === name || key.toUpperCase() !== upperName || typeof value !== "string") continue;
		const trimmed = value.trim();
		if (trimmed) return trimmed;
	}
	return undefined;
}

function selectProxy(
	env: Readonly<Record<string, string | undefined>>,
	names: readonly string[],
): SelectedProxy {
	for (const name of names) {
		const value = readNonEmptyEnvironmentValue(env, name);
		if (value) return { value, name };
	}
	return {};
}

function validateProxy(value: SelectedProxy, target: "HTTP" | "HTTPS"): string | undefined {
	if (!value.value) return undefined;
	let parsed: URL;
	try {
		parsed = new URL(value.value);
	} catch {
		throw new Error(`Invalid Cursor ${target} proxy from ${value.name ?? "environment"}; use an http:// or https:// proxy URL.`);
	}
	if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) {
		throw new Error(`Invalid Cursor ${target} proxy from ${value.name ?? "environment"}; use an http:// or https:// proxy URL.`);
	}
	return value.value;
}

export function resolveCursorProxyEnvironment(
	env: Readonly<Record<string, string | undefined>> = process.env,
): CursorProxyEnvironment {
	const genericOrCursor = selectProxy(env, ["PI_PROXY_CURSOR", "PI_PROXY"]);
	const httpProxy = genericOrCursor.value
		? genericOrCursor
		: selectProxy(env, ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"]);
	const httpsProxy = genericOrCursor.value
		? genericOrCursor
		: selectProxy(env, ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY"]);

	return {
		httpProxy: validateProxy(httpProxy, "HTTP"),
		httpsProxy: validateProxy(httpsProxy, "HTTPS"),
		noProxy: readNonEmptyEnvironmentValue(env, "NO_PROXY"),
	};
}

function toNodeProxyEnvironment(environment: CursorProxyEnvironment): Record<string, string> {
	const proxyEnv: Record<string, string> = {};
	if (environment.httpProxy) proxyEnv.HTTP_PROXY = environment.httpProxy;
	if (environment.httpsProxy) proxyEnv.HTTPS_PROXY = environment.httpsProxy;
	proxyEnv.NO_PROXY = withLoopbackNoProxy(environment.noProxy);
	return proxyEnv;
}

const LOOPBACK_NO_PROXY_HOSTS = ["localhost", "127.0.0.1", "::1"] as const;

function withLoopbackNoProxy(value: string | undefined): string {
	const entries = (value?.split(",") ?? []).map((entry) => entry.trim()).filter(Boolean);
	for (const host of LOOPBACK_NO_PROXY_HOSTS) {
		if (!entries.includes(host)) entries.push(host);
	}
	return entries.join(",");
}

function installProxyForEnvironment(
	env: Readonly<Record<string, string | undefined>>,
	installGlobalProxy: GlobalProxyInstaller,
): CursorProxyEnvironment {
	const environment = resolveCursorProxyEnvironment(env);
	if (!environment.httpProxy && !environment.httpsProxy) return environment;

	const restore = installGlobalProxy(toNodeProxyEnvironment(environment));
	activeProxyEnvironment = environment;
	restoreGlobalProxy = restore;
	return environment;
}

function installNativeGlobalProxy(proxyEnv: Record<string, string>): () => void {
	if (typeof nodeHttp.setGlobalProxyFromEnv !== "function") {
		throw new Error("Cursor proxy support requires a runtime with http.setGlobalProxyFromEnv().");
	}
	return nodeHttp.setGlobalProxyFromEnv(proxyEnv);
}

/**
 * Cursor SDK does not expose a per-agent proxy hook. Keep the native global
 * proxy active for the extension lifetime, then restore it only through the
 * explicit teardown helper used by tests and other process-level cleanup.
 * Read process.env directly: OMP's $env also includes project dotenv values.
 */
export function installCursorProxyTransport(onError?: (error: Error) => void): CursorProxyEnvironment {
	if (activeProxyEnvironment) return activeProxyEnvironment;
	try {
		return installProxyForEnvironment(process.env, installNativeGlobalProxy);
	} catch (error) {
		onError?.(error instanceof Error ? error : new Error("Cursor proxy installation failed."));
		return {};
	}
}

export function isCursorProxyEnabled(): boolean {
	return activeProxyEnvironment !== undefined;
}

export function assertCursorProxyLocalHttp1(useHttp1ForAgent: boolean): void {
	if (!isCursorProxyEnabled() || useHttp1ForAgent) return;
	throw new Error(
		"Cursor local Agent proxy transport requires HTTP/1.1; set PI_CURSOR_HTTP_1_1=true or run /cursor-http on.",
	);
}

export function restoreCursorProxyTransport(): void {
	const restore = restoreGlobalProxy;
	restoreGlobalProxy = undefined;
	activeProxyEnvironment = undefined;
	restore?.();
}

export const __testUtils = {
	installProxyForEnvironment,
	reset: restoreCursorProxyTransport,
};
