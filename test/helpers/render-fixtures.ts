import type { CursorReplayRenderTheme } from "../../src/cursor-native-tool-display-replay.js";

export type HarnessRenderTheme = CursorReplayRenderTheme;
export type HarnessRenderContext = Record<string, unknown>;
export type HarnessRenderResultOptions = {
	expanded: boolean;
	isPartial: boolean;
};

export function createRenderTheme(
	overrides: {
		fg?: (style: string, text: string) => string;
		bold?: (text: string) => string;
		styledSymbol?: (symbol: string, style: string) => string;
	} = {},
): HarnessRenderTheme {
	return {
		fg: (style: string, text: string) => text,
		bold: (text: string) => text,
		styledSymbol: (_symbol: string, _style: string) => "",
		...overrides,
	} as HarnessRenderTheme;
}

export function createRenderOptions(overrides: Partial<HarnessRenderResultOptions> = {}): HarnessRenderResultOptions {
	return {
		expanded: false,
		isPartial: false,
		...overrides,
	};
}

export function createRenderContext(overrides: Record<string, unknown> = {}): HarnessRenderContext {
	return {
		args: {},
		toolCallId: "test-tool-call",
		invalidate: () => {},
		lastComponent: undefined,
		state: undefined,
		cwd: process.cwd(),
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded: false,
		showImages: false,
		isError: false,
		...overrides,
	};
}
