import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { defineConfig, type Plugin } from "vitest/config";

const projectRoot = resolve(".");
const textAssetAsModule: Plugin = {
	enforce: "pre",
	load(id) {
		const filePath = id.split("?", 1)[0];
		if (!/\.(?:md|html|sh|py|txt|applescript)$/.test(filePath)) return undefined;
		return `export default ${JSON.stringify(readFileSync(filePath, "utf8"))};`;
	},
	resolveId(source, importer) {
		const filePath = source.split("?", 1)[0];
		if (!/\.(?:md|html|sh|py|txt|applescript)$/.test(filePath)) return null;
		if (isAbsolute(filePath)) return filePath;
		if (importer && filePath.startsWith(".")) return resolve(dirname(importer), filePath);
		return null;
	},
	transform(code, id) {
		if (!id.includes("node_modules/@oh-my-pi/")) return undefined;
		if (!code.includes("import.meta.dir")) return undefined;
		return {
			code: code.replaceAll("import.meta.dir", JSON.stringify(dirname(id))),
			map: null,
		};
	},
};

export default defineConfig({
	plugins: [textAssetAsModule],
	resolve: {
		alias: [
			{
				find: /^@oh-my-pi\/pi-coding-agent$/,
				replacement: resolve(projectRoot, "test/omp-coding-agent-runtime-stub.ts"),
			},
		],
	},
	test: {
		maxWorkers: 4,
		setupFiles: ["test/setup.ts"],
		include: ["test/**/*.test.ts"],
		exclude: ["test/**/*.compile.test.ts"],
	},
});
