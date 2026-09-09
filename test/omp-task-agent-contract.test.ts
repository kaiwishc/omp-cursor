import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

type PackageManifest = {
	files?: string[];
};

describe("OMP Cursor task agent contract", () => {
	it("ships a discoverable cursor agent routed through cursor-sdk/default", () => {
		const manifest = JSON.parse(readFileSync("package.json", "utf8")) as PackageManifest;
		const definition = readFileSync("agents/cursor.md", "utf8");

		expect(manifest.files).toContain("agents/cursor.md");
		expect(definition).toContain("name: cursor");
		expect(definition).toContain("model: cursor-sdk/default");
		expect(definition).not.toContain("model: cursor/auto");
	});
});
