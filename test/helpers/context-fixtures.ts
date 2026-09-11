import { AuthStorage } from "@oh-my-pi/pi-ai";
import { vi } from "vitest";
import type { AssistantMessage, AssistantMessageEvent, Context } from "@oh-my-pi/pi-ai";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import type {
	BuildSystemPromptOptions,
	ExtensionCommandContext,
	ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";
import { makeModel } from "./model-fixtures.js";
import type { ExtensionCommandContextOverrides, ExtensionContextOverrides } from "./pi-harness-types.js";

const sharedTestModelRegistry = new ModelRegistry(await AuthStorage.create(":memory:"), undefined);

function getSharedTestModelRegistry(): ModelRegistry {
	return sharedTestModelRegistry;
}

export function createDefaultSystemPromptOptions(cwd: string): BuildSystemPromptOptions {
	return { cwd };
}

function createMinimalSessionManager(
	cwd: string,
	overrides: Partial<ExtensionContext["sessionManager"]> = {},
): ExtensionContext["sessionManager"] {
	return {
		getCwd: vi.fn(() => cwd),
		getSessionDir: vi.fn(() => ""),
		getSessionId: vi.fn(() => "test-session"),
		getSessionFile: vi.fn(() => undefined),
		getLeafId: vi.fn(() => null),
		getLeafEntry: vi.fn(() => undefined),
		getEntry: vi.fn(() => undefined),
		getLabel: vi.fn(() => undefined),
		getBranch: vi.fn(() => []),
		getHeader: vi.fn(() => null),
		getEntries: vi.fn(() => []),
		getTree: vi.fn(() => []),
		getSessionName: vi.fn(() => undefined),
		...overrides,
	} as unknown as ExtensionContext["sessionManager"];
}

function createMinimalExtensionUi(): ExtensionContext["ui"] {
	return {
		select: vi.fn(async () => undefined),
		confirm: vi.fn(async () => false),
		input: vi.fn(async () => undefined),
		notify: vi.fn(),
		onTerminalInput: vi.fn(() => () => {}),
		setStatus: vi.fn(),
		setWorkingMessage: vi.fn(),
		setWorkingVisible: vi.fn(),
		setWorkingIndicator: vi.fn(),
		setHiddenThinkingLabel: vi.fn(),
		setWidget: vi.fn(),
		setFooter: vi.fn(),
		setHeader: vi.fn(),
		setTitle: vi.fn(),
		custom: vi.fn(async () => undefined),
		pasteToEditor: vi.fn(),
		setEditorText: vi.fn(),
		getEditorText: vi.fn(() => ""),
		editor: vi.fn(async () => undefined),
		addAutocompleteProvider: vi.fn(),
		setEditorComponent: vi.fn(),
		getEditorComponent: vi.fn(() => undefined),
		theme: {} as ExtensionContext["ui"]["theme"],
		getAllThemes: vi.fn(async () => []),
		getTheme: vi.fn(async () => undefined),
		setTheme: vi.fn(async () => ({ success: true })),
		getToolsExpanded: vi.fn(() => false),
		setToolsExpanded: vi.fn(),
	} as unknown as ExtensionContext["ui"];
}

function createMinimalExtensionContextInternal(overrides: ExtensionContextOverrides = {}): ExtensionContext {
	const cwd = overrides.cwd ?? process.cwd();
	const base = {
		ui: createMinimalExtensionUi(),
		mode: "tui" as const,
		hasUI: true,
		cwd,
		sessionManager: createMinimalSessionManager(cwd, overrides.sessionManager),
		modelRegistry: getSharedTestModelRegistry(),
		model: makeModel("composer-2.5"),
		isIdle: vi.fn(() => true),
		isProjectTrusted: vi.fn(() => true),
		abort: vi.fn(),
		hasPendingMessages: vi.fn(() => false),
		shutdown: vi.fn(),
		getContextUsage: vi.fn(() => undefined),
		compact: vi.fn(),
		getSystemPrompt: vi.fn(() => [] as string[]),
	} as unknown as ExtensionContext;
	return {
		...base,
		...overrides,
		ui: { ...base.ui, ...overrides.ui },
		sessionManager: { ...base.sessionManager, ...overrides.sessionManager },
	} as ExtensionContext;
}

function createMinimalExtensionCommandContextInternal(
	overrides: ExtensionCommandContextOverrides = {},
): ExtensionCommandContext {
	const base = createMinimalExtensionContextInternal(overrides as unknown as ExtensionContextOverrides) as ExtensionCommandContext;
	return {
		...base,
		...overrides,
		waitForIdle: overrides.waitForIdle ?? vi.fn(async () => undefined),
		newSession: overrides.newSession ?? vi.fn(async () => ({ cancelled: false })),
		navigateTree: overrides.navigateTree ?? vi.fn(async () => ({ cancelled: false })),
		switchSession: overrides.switchSession ?? vi.fn(async () => ({ cancelled: false })),
		reload: overrides.reload ?? vi.fn(async () => undefined),
		ui: { ...base.ui, ...overrides.ui },
		sessionManager: { ...base.sessionManager, ...overrides.sessionManager },
	} as ExtensionCommandContext;
}

export function createExtensionTestContext(ctxOverrides: ExtensionContextOverrides = {}): ExtensionContext {
	return createMinimalExtensionContextInternal(ctxOverrides);
}

export function createExtensionCommandContext(
	ctxOverrides: ExtensionCommandContextOverrides = {},
): ExtensionCommandContext {
	return createMinimalExtensionCommandContextInternal(ctxOverrides);
}

export function makeContext(messages: Context["messages"] = [{ role: "user", content: "Hello", timestamp: 1 }]): Context {
	return {
		systemPrompt: ["Be helpful."],
		messages,
	};
}

export function makeAssistantMessage(text = "Done", timestamp = 2): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "cursor-sdk",
		provider: "cursor",
		model: "test-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp,
	};
}

export async function collectEvents<TEvent>(stream: AsyncIterable<TEvent>): Promise<TEvent[]> {
	const events: TEvent[] = [];
	for await (const event of stream) {
		events.push(event);
	}
	return events;
}

export async function collectAssistantEvents(
	stream: AsyncIterable<AssistantMessageEvent>,
): Promise<AssistantMessageEvent[]> {
	return collectEvents(stream);
}
