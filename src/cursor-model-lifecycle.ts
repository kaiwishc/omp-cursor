import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionAPI,
	ExtensionContext,
	ExtensionHandler,
	SessionStartEvent,
	TurnStartEvent,
} from "@oh-my-pi/pi-coding-agent";

export type CursorModelLifecycleContext = ExtensionContext;


type CursorModelLifecycleSyncHandler = (ctx: CursorModelLifecycleContext) => Promise<void> | void;
type CursorModelSessionStartHandler = ExtensionHandler<SessionStartEvent>;
type CursorModelTurnStartHandler = ExtensionHandler<TurnStartEvent>;
type CursorModelBeforeAgentStartHandler = ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>;

export type CursorModelLifecycleExtensionApi = Pick<ExtensionAPI, "on">;

export interface CursorModelLifecycleHandlers {
	sessionStart?: CursorModelSessionStartHandler;
	turnStart?: CursorModelTurnStartHandler;
	sync?: CursorModelLifecycleSyncHandler;
	beforeAgentStart?: CursorModelBeforeAgentStartHandler;
}

function normalizeLifecycleHandlers(
	handlerOrHandlers: CursorModelLifecycleSyncHandler | CursorModelLifecycleHandlers,
): CursorModelLifecycleHandlers {
	return typeof handlerOrHandlers === "function" ? { sync: handlerOrHandlers } : handlerOrHandlers;
}

export function registerCursorModelLifecycle(
	pi: CursorModelLifecycleExtensionApi,
	handlerOrHandlers: CursorModelLifecycleSyncHandler | CursorModelLifecycleHandlers,
): void {
	const handlers = normalizeLifecycleHandlers(handlerOrHandlers);
	const sync = handlers.sync;
	if (handlers.sessionStart || sync) {
		pi.on("session_start", async (event: SessionStartEvent, ctx: ExtensionContext) => {
			await handlers.sessionStart?.(event, ctx);
			await sync?.(ctx);
		});
	}
	if (handlers.turnStart || sync) {
		pi.on("turn_start", async (event: TurnStartEvent, ctx: ExtensionContext) => {
			await handlers.turnStart?.(event, ctx);
			await sync?.(ctx);
		});
	}
	if (handlers.beforeAgentStart || sync) {
		pi.on("before_agent_start", async (event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
			await sync?.(ctx);
			return await handlers.beforeAgentStart?.(event, ctx);
		});
	}
}
