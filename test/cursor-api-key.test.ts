import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CURSOR_API_KEY_CONFIG_VALUE,
	resolveCursorApiKey,
	resolveCursorApiKeyValue,
	resolveCursorRuntimeApiKey,
} from "../src/cursor-api-key.js";

function writeCursorSdkUserConfig(apiKey: string): void {
	const path = join(process.env.PI_CODING_AGENT_DIR!, "cursor-sdk.json");
	writeFileSync(path, JSON.stringify({ apiKey }, null, 2));
	if (process.platform !== "win32") chmodSync(path, 0o600);
}

describe("cursor-api-key helpers", () => {
	const originalEnv = process.env;
	const originalArgv = process.argv;
	let tmpAgentDir: string;

	beforeEach(() => {
		process.env = { ...originalEnv };
		delete process.env.CURSOR_API_KEY;
		tmpAgentDir = mkdtempSync(join(tmpdir(), "omp-cursor-api-key-"));
		process.env.PI_CODING_AGENT_DIR = tmpAgentDir;
		process.argv = ["bun", "vitest"];
	});

	afterEach(() => {
		rmSync(tmpAgentDir, { recursive: true, force: true });
		process.env = originalEnv;
		process.argv = originalArgv;
	});

	it.each(["CURSOR_API_KEY", "$CURSOR_API_KEY", "${CURSOR_API_KEY}", CURSOR_API_KEY_CONFIG_VALUE])(
		"resolves placeholder %s through env only",
		(placeholder) => {
			expect(resolveCursorApiKey(placeholder)).toBeUndefined();
			process.env.CURSOR_API_KEY = "env-key-123";
			expect(resolveCursorApiKey(placeholder)).toBe("env-key-123");
		},
	);

	it("does not inspect process argv for runtime credentials", async () => {
		process.argv = [
			"bun", "omp", "--model", "anthropic/first", "--api-key", "first-key",
			"--model=cursor-sdk/unsupported", "--api-key=equals-key",
		];
		expect(await resolveCursorRuntimeApiKey()).toBeUndefined();
	});

	it("resolves the OMP user config after the environment", async () => {
		writeCursorSdkUserConfig("config-key-123");
		expect(await resolveCursorRuntimeApiKey()).toBe("config-key-123");

		process.env.CURSOR_API_KEY = "env-key-123";
		expect(await resolveCursorRuntimeApiKey()).toBe("env-key-123");
	});

	it("resolves an OMP ApiKey resolver without reading auth storage", async () => {
		const resolver = vi.fn(() => "resolver-key-123");
		expect(await resolveCursorApiKeyValue(resolver)).toBe("resolver-key-123");
		expect(resolver).toHaveBeenCalledOnce();
	});

	it("never reads OMP auth storage", async () => {
		writeFileSync(
			join(process.env.PI_CODING_AGENT_DIR!, "auth.json"),
			JSON.stringify({ cursor: { type: "api_key", key: "stored-key-123" } }, null, 2),
		);
		expect(await resolveCursorRuntimeApiKey()).toBeUndefined();
	});
});
