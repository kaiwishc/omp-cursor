import { resolveApiKeyOnce, type ApiKey } from "@oh-my-pi/pi-ai";
import { loadCursorSdkUserConfig } from "./cursor-config.js";

export const CURSOR_API_KEY_ENV_VAR = "CURSOR_API_KEY";

// Keep a non-secret literal sentinel in the OMP provider registry. OMP treats
// an absent environment-backed value as unconfigured, which would hide fallback
// models before the runtime key is available. Resolve the real key on demand
// from CURSOR_API_KEY or the OMP user config.
export const CURSOR_API_KEY_CONFIG_VALUE = "omp-cursor-cursor-api-key-placeholder";

const CURSOR_API_KEY_PLACEHOLDERS: Record<string, true> = {
	[CURSOR_API_KEY_ENV_VAR]: true,
	[`$${CURSOR_API_KEY_ENV_VAR}`]: true,
	[`\${${CURSOR_API_KEY_ENV_VAR}}`]: true,
	[CURSOR_API_KEY_CONFIG_VALUE]: true,
};

/** Resolve a concrete string without invoking OMP's resolver callbacks. */
export function resolveCursorApiKey(apiKey?: unknown): string | undefined {
	const trimmed = typeof apiKey === "string" ? apiKey.trim() : undefined;
	if (!trimmed) return undefined;
	if (CURSOR_API_KEY_PLACEHOLDERS[trimmed]) return process.env.CURSOR_API_KEY?.trim() || undefined;
	return trimmed;
}

async function getConfiguredCursorApiKey(): Promise<string | undefined> {
	try {
		return resolveCursorApiKey(loadCursorSdkUserConfig().apiKey);
	} catch {
		return undefined;
	}
}

/**
 * Resolve a caller-supplied OMP key, including ApiKey resolvers, without
 * opening OMP's auth database. A resolver may return the registry sentinel;
 * resolve that through the same environment/config fallback as a string key.
 */
export async function resolveCursorApiKeyValue(apiKey?: ApiKey): Promise<string | undefined> {
	try {
		return resolveCursorApiKey(await resolveApiKeyOnce(apiKey));
	} catch {
		return undefined;
	}
}

/**
 * Resolve the runtime API key without opening OMP's auth database. The Cursor
 * SDK provider accepts only the process environment or its fixed user config.
 */
export async function resolveCursorRuntimeApiKey(apiKey?: ApiKey): Promise<string | undefined> {
	return (
		(await resolveCursorApiKeyValue(apiKey)) ??
		resolveCursorApiKey(process.env.CURSOR_API_KEY) ??
		(await getConfiguredCursorApiKey())
	);
}
