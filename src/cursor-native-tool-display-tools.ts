import type { ExtensionAPI, ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@oh-my-pi/pi-coding-agent/extensibility/legacy-pi-coding-agent-shim";
import { Text, type Component } from "@oh-my-pi/pi-tui";
import { getCursorSessionCwd } from "./cursor-session-scope.js";
import {
	BUILTIN_NATIVE_CURSOR_TOOL_NAMES,
	CURSOR_MODEL_ACTIVE_REPLAY_TOOL_NAMES,
	CURSOR_REPLAY_TOOL_NAMES,
	isNativeCursorToolName,
	NATIVE_CURSOR_TOOL_NAMES,
	type BuiltinNativeCursorToolName,
	type NativeCursorToolName,
} from "./cursor-native-tool-names.js";
import { isCursorReplayToolName } from "./cursor-tool-presentation-registry.js";
import {
	createCursorReplayOnlyToolDefinition,
	isCursorReplayNativeEditDetails,
	isCursorReplayNativeWriteDetails,
	parseCursorReplayToolDetails,
	renderCursorReplayResult,
	renderNativeLookingCursorFileMutationCall,
	renderNativeLookingCursorReadReplayResult,
} from "./cursor-native-tool-display-replay.js";
import { consumeCursorNativeToolDisplay, isCursorReplayToolCallId } from "./cursor-native-tool-display-state.js";

type AnyToolDefinition = ToolDefinition;
type RenderCall = NonNullable<AnyToolDefinition["renderCall"]>;
type RenderResult = NonNullable<AnyToolDefinition["renderResult"]>;

type NativeReplayStrategy = {
	createDefinition: (cwd: string) => AnyToolDefinition;
	missingReplayPolicy?: "block-file-mutation";
	renderReplayCall?: (
		args: Parameters<RenderCall>[0],
		options: Parameters<RenderCall>[1],
		theme: Parameters<RenderCall>[2],
		renderBase: () => Component | undefined,
	) => Component;
	renderReplayResult?: (
		result: Parameters<RenderResult>[0],
		options: Parameters<RenderResult>[1],
		theme: Parameters<RenderResult>[2],
		renderBase: () => Component | undefined,
	) => Component;
};

function emptyText(): Text {
	return new Text("", 0, 0);
}

function renderReadReplayCall(
	args: Parameters<RenderCall>[0],
	options: Parameters<RenderCall>[1],
	theme: Parameters<RenderCall>[2],
	renderBase: () => Component | undefined,
): Component {
	const rendered = renderBase() ?? emptyText();
	if ((args as Record<string, unknown>).localReadPreview !== true || options.expanded) return rendered;
	const rawPath = (args as Record<string, unknown>).path;
	const readPath = typeof rawPath === "string" ? rawPath : "";
	const labeled = `${theme.fg("toolTitle", theme.bold("Read:"))} ${theme.fg("muted", readPath)}${theme.fg("muted", " · local file preview")}`;
	if (rendered instanceof Text) {
		rendered.setText(labeled);
		return rendered;
	}
	return new Text(labeled, 0, 0);
}

function renderReadReplayResult(
	result: Parameters<RenderResult>[0],
	options: Parameters<RenderResult>[1],
	theme: Parameters<RenderResult>[2],
	renderBase: () => Component | undefined,
): Component {
	return renderNativeLookingCursorReadReplayResult(result, options, theme, renderBase);
}

function renderEditReplayResult(
	result: Parameters<RenderResult>[0],
	options: Parameters<RenderResult>[1],
	theme: Parameters<RenderResult>[2],
	renderBase: () => Component | undefined,
): Component {
	const details = parseCursorReplayToolDetails(result.details);
	return details && isCursorReplayNativeEditDetails(details)
		? renderCursorReplayResult(result, options, theme)
		: renderBase() ?? emptyText();
}

function renderWriteReplayResult(
	result: Parameters<RenderResult>[0],
	options: Parameters<RenderResult>[1],
	theme: Parameters<RenderResult>[2],
	renderBase: () => Component | undefined,
): Component {
	const details = parseCursorReplayToolDetails(result.details);
	return details && isCursorReplayNativeWriteDetails(details)
		? renderCursorReplayResult(result, options, theme)
		: renderBase() ?? emptyText();
}

const NATIVE_CURSOR_TOOL_STRATEGIES: Record<BuiltinNativeCursorToolName, NativeReplayStrategy> = {
	read: {
		createDefinition: (cwd) => createReadToolDefinition(cwd),
		renderReplayCall: renderReadReplayCall,
		renderReplayResult: renderReadReplayResult,
	},
	bash: { createDefinition: (cwd) => createBashToolDefinition(cwd) },
	edit: {
		createDefinition: (cwd) => createEditToolDefinition(cwd),
		missingReplayPolicy: "block-file-mutation",
		renderReplayCall: (args, options, theme) =>
			renderNativeLookingCursorFileMutationCall("edit", args as Record<string, unknown>, theme, options.isPartial),
		renderReplayResult: renderEditReplayResult,
	},
	write: {
		createDefinition: (cwd) => createWriteToolDefinition(cwd),
		missingReplayPolicy: "block-file-mutation",
		renderReplayCall: (args, options, theme) =>
			renderNativeLookingCursorFileMutationCall("write", args as Record<string, unknown>, theme, options.isPartial),
		renderReplayResult: renderWriteReplayResult,
	},
	grep: { createDefinition: (cwd) => createGrepToolDefinition(cwd) },
	find: { createDefinition: (cwd) => createFindToolDefinition(cwd) },
	ls: { createDefinition: (cwd) => createLsToolDefinition(cwd) },
};

function getNativeReplayStrategy(toolName: string): NativeReplayStrategy | undefined {
	return Object.hasOwn(NATIVE_CURSOR_TOOL_STRATEGIES, toolName)
		? NATIVE_CURSOR_TOOL_STRATEGIES[toolName as BuiltinNativeCursorToolName]
		: undefined;
}

export function wrapNativeCursorTool(
	definition: AnyToolDefinition,
	getCurrentDefinition: () => AnyToolDefinition,
): AnyToolDefinition {
	const strategy = getNativeReplayStrategy(definition.name);
	const wrapped = {
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const cursorDisplay = consumeCursorNativeToolDisplay(toolCallId);
			if (cursorDisplay) {
				if (cursorDisplay.isError) {
					const text = cursorDisplay.result.content
						.map((entry) => (entry.type === "text" ? entry.text : undefined))
						.filter((entry): entry is string => Boolean(entry))
						.join("\n");
					throw new Error(text || "Cursor tool replay failed");
				}
				return {
					content: cursorDisplay.result.content,
					details: cursorDisplay.result.details,
				};
			}
			if (strategy?.missingReplayPolicy === "block-file-mutation" && isCursorReplayToolCallId(toolCallId)) {
				throw new Error(`No recorded Cursor ${definition.name} result was available. This replay-only call does not execute file mutations.`);
			}
			if (typeof ctx.invokeTool === "function") {
				return ctx.invokeTool(params as Record<string, unknown>, { signal, onUpdate });
			}
			return getCurrentDefinition().execute(toolCallId, params, signal, onUpdate, ctx);
		},
		renderCall(args, options, theme) {
			const currentRenderCall = getCurrentDefinition().renderCall;
			const renderBase = () => currentRenderCall?.(args, options, theme) ?? emptyText();
			return strategy?.renderReplayCall?.(args, options, theme, renderBase) ?? renderBase();
		},
		renderResult(result, options, theme) {
			const currentRenderResult = getCurrentDefinition().renderResult;
			const renderBase = () => currentRenderResult?.(result, options, theme) ?? emptyText();
			return strategy?.renderReplayResult?.(result, options, theme, renderBase) ?? renderBase();
		},
	} as AnyToolDefinition;

	const visited = new Set<PropertyKey>();
	let current: object | null = definition;
	while (current && current !== Object.prototype) {
		for (const key of Reflect.ownKeys(current)) {
			if (key === "constructor" || visited.has(key) || key in wrapped) continue;
			visited.add(key);
			Object.defineProperty(wrapped, key, {
				get() {
					const value = Reflect.get(definition, key);
					if (key === "parameters" || typeof value !== "function" || typeof value.bind !== "function") return value;
					return value.bind(definition);
				},
				enumerable: true,
				configurable: true,
			});
		}
		current = Object.getPrototypeOf(current);
	}
	return wrapped;
}

export function createNativeCursorToolDefinition(toolName: NativeCursorToolName, cwd: string): AnyToolDefinition {
	const strategy = getNativeReplayStrategy(toolName);
	if (strategy) return strategy.createDefinition(cwd);
	if (isCursorReplayToolName(toolName)) return createCursorReplayOnlyToolDefinition(toolName);
	throw new Error(`Unsupported Cursor native replay tool: ${toolName}`);
}

export function registerNativeCursorTool(
	pi: Pick<ExtensionAPI, "registerTool">,
	toolName: NativeCursorToolName,
): void {
	const definition = createNativeCursorToolDefinition(toolName, getCursorSessionCwd());
	pi.registerTool(wrapNativeCursorTool(definition, () => createNativeCursorToolDefinition(toolName, getCursorSessionCwd())));
}

export { BUILTIN_NATIVE_CURSOR_TOOL_NAMES, CURSOR_MODEL_ACTIVE_REPLAY_TOOL_NAMES, CURSOR_REPLAY_TOOL_NAMES, isNativeCursorToolName, NATIVE_CURSOR_TOOL_NAMES };
