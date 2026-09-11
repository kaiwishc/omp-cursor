import { isCursorModel } from "./cursor-model.js";
import { registerCursorModelLifecycle, type CursorModelLifecycleExtensionApi } from "./cursor-model-lifecycle.js";
import { resolveEffectiveCursorConfigForContext } from "./cursor-runtime-state.js";
import { parsePiProjectContextFiles, resolveCursorFacingSystemPrompt } from "./cursor-agents-context.js";

export type CursorAgentsContextExtensionApi = CursorModelLifecycleExtensionApi;


export function registerCursorAgentsContextDedup(pi: CursorAgentsContextExtensionApi): void {
	registerCursorModelLifecycle(pi, {
		beforeAgentStart: (event, ctx) => {
			if (!isCursorModel(ctx.model)) return undefined;
			const runtime = resolveEffectiveCursorConfigForContext(ctx).runtime.value;
			const original = event.systemPrompt.join("\n\n");
			const contextFiles = parsePiProjectContextFiles(original);
			const resolved = resolveCursorFacingSystemPrompt(
				original,
				ctx.model,
				contextFiles.length > 0 ? { contextFiles } : undefined,
				undefined,
				undefined,
				runtime,
			);
			if (resolved === original) return undefined;
			return { systemPrompt: resolved ? [resolved] : [] };
		},
	});
}
