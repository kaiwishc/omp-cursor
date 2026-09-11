import { describe, expect, it, vi } from "vitest";
import { Text } from "@oh-my-pi/pi-tui"
import type { ToolDefinition } from "@oh-my-pi/pi-coding-agent"
import { Type } from "@oh-my-pi/omptype/typebox"
import * as replay from "../src/cursor-native-tool-display-replay.js";
import { createNativeCursorToolDefinition, wrapNativeCursorTool } from "../src/cursor-native-tool-display-tools.js";
import { createRenderContext, createRenderOptions, createRenderTheme } from "./helpers/render-fixtures.js";

describe("wrapNativeCursorTool", () => {
	it("does not use Cursor replay rendering for ordinary pi edit toolCallIds", () => {
		const replaySpy = vi.spyOn(replay, "renderCursorReplayResult").mockReturnValue(new Text("", 0, 0));
		const parameters = Type.Object({});
		type EditToolDefinition = ToolDefinition<typeof parameters, unknown>;
		const delegateRenderResult = vi.fn<NonNullable<EditToolDefinition["renderResult"]>>(() => new Text("pi edit", 0, 0));
		const definition: EditToolDefinition = {
			name: "edit",
			label: "edit",
			description: "edit",
			parameters,
			execute: vi.fn(async () => ({ content: [], details: undefined })),
			renderResult: delegateRenderResult,
		};
		const wrapped = wrapNativeCursorTool(definition, () => definition);
		const theme = createRenderTheme();

		wrapped.renderResult?.(
			{
				content: [{ type: "text", text: "edit src/foo.ts" }],
				details: {
					path: "src/foo.ts",
					diffString: "--- a\n+++ b\n",
					linesAdded: 1,
					linesRemoved: 1,
				},
			},
			createRenderOptions(),
			theme,
			createRenderContext({ isError: false, toolCallId: "ordinary-edit-1" }),
		);

		expect(replaySpy).not.toHaveBeenCalled();
		expect(delegateRenderResult).toHaveBeenCalledOnce();
		replaySpy.mockRestore();
	});

	it("preserves metadata from OMP compatibility tool definitions", () => {
		for (const toolName of ["read", "bash", "edit", "write", "grep", "find", "ls"] as const) {
			const definition = createNativeCursorToolDefinition(toolName, process.cwd());
			const wrapped = wrapNativeCursorTool(definition, () => definition);

			expect(wrapped.name).toBe(definition.name);
			expect(wrapped.label).toBe(definition.label);
			expect(wrapped.description).toBe(definition.description);
			expect(wrapped.parameters).toBe(definition.parameters);
		}
	});
});
