import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { clearCursorSdkHttp1 } from "./cursor-http1.js";
import { onCursorSessionScopeKeyChange } from "./cursor-session-scope.js";
import {
	disposeSessionCursorAgent,
	invalidateSessionAgent,
	resetSessionCursorAgent,
} from "./cursor-session-agent.js";

export type CursorSessionAgentLifecycleExtensionApi = Pick<ExtensionAPI, "on">;

export function registerCursorSessionAgentLifecycle(pi: CursorSessionAgentLifecycleExtensionApi): void {
	onCursorSessionScopeKeyChange(async (previousScopeKey) => {
		await disposeSessionCursorAgent(previousScopeKey);
	});
	pi.on("session_shutdown", async () => {
		try {
			await disposeSessionCursorAgent();
		} finally {
			clearCursorSdkHttp1();
		}
	});
	pi.on("session_compact", () => {
		invalidateSessionAgent();
	});
	pi.on("session_before_tree", () => {
		invalidateSessionAgent();
	});
	pi.on("session_tree", async () => {
		await resetSessionCursorAgent();
	});
}
