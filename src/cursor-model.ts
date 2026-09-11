import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent"

export const CURSOR_PROVIDER = "cursor-sdk";
export const CURSOR_SDK_API = CURSOR_PROVIDER;

export type CursorModelRef =
	| Pick<NonNullable<ExtensionContext["model"]>, "provider" | "api">
	| undefined;

export function isCursorModel(model: CursorModelRef): boolean {
	return model?.provider === CURSOR_PROVIDER || model?.api === CURSOR_SDK_API;
}
