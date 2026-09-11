# Cursor Model UX Spec

> Maintainer note: this is an internal design and behavior spec for omp-cursor. If you are trying to install or use the extension, start with the main [README](../README.md) instead.

## Status

Implemented design target. This file describes the intended Cursor model UX and should stay aligned with the current code in `src/`.

Current implementation notes:

- Cursor context variants use `base@context` OMP model IDs.
- Cursor `reasoning`, `effort`, and boolean `thinking` parameters are driven by OMP native thinking when the Cursor SDK exposes those controls.
- Cursor `fast` is extension state by default; models that expose `fast` also get selection-only `:fast` / `:slow` virtual aliases for per-agent overrides.
- Cursor SDK `mode` (`agent` or `plan`) is extension session state, not model identity, OMP thinking, Cursor `fast`, or OMP's separate plan-mode extension.
- Cursor status uses one coordinated `ctx.ui.setStatus("cursor", ...)` value for fast, non-default plan mode, and the local-only `http1` transport marker; the default OMP footer remains intact.
- Installed `@cursor/sdk` user messages accept images, and Cursor models are treated as image-capable; registered input metadata is `text` plus `image`.
- Image payload forwarding sends images only from the latest user message. If the latest user turn is plain text after an earlier image turn, the transcript keeps an `[image omitted from transcript]` placeholder but no image bytes are sent to Cursor. The prompt explicitly tells Cursor that prior image bytes are unavailable and to ask the user to reattach or describe a prior image when needed. Carrying images forward across turns remains a future product decision because it affects token cost, privacy, stale visual context, and expected multimodal follow-up behavior.
- Exact `@cursor/sdk@1.0.27` is a package dependency of this extension; users should not need a global SDK install. OMP 18.1.15 is the minimum supported and current validation baseline.
- After each finished SDK run, the provider calls `agent.getUsage()` (no `runId` on local agents; `runId` only for cloud `run-*` IDs) and maps billed spend into OMP `usage` spend fields. Occupancy `totalTokens` uses only in-window local turn-ended occupancy below the latest compaction `tokensBefore`; billed rows never become occupancy, so footer/auto-compact stay aligned with the post-compact Cursor prompt.
- Startup discovery reads `CURSOR_API_KEY` first and then `apiKey` in global `~/.omp/agent/cursor-sdk.json`; otherwise it registers the bundled fallback catalog. No `auth.json` is read, and project `.omp/cursor-sdk.json` never supplies credentials. Provider turns keep OMP's resolved `options.apiKey` and use the same runtime fallback when no concrete key is supplied. `/cursor-refresh-models` and `/cursor-cloud`...
- Cursor Cloud repository overrides accept only HTTPS repository URLs without userinfo, query parameters, or fragments. Invalid values fail during preflight before `Agent.create()`, messages never echo the supplied URL, and shared provider/maintainer scrubbing removes URL/SCP-style userinfo defensively.
- Cursor Cloud requires a persisted OMP session. Immediately after remote `Agent.create()` returns, before debug work or abort checks, the provider appends a branch-local OMP lifecycle entry, fsyncs the existing OMP session JSONL anchor through a read-write descriptor, and then fsyncs a newline-framed sidecar keyed by the stable OMP session ID (POSIX mode `0600`; Windows inherits the user session directory ACL) in the session directory. Journal creation is exclusive, and existing append/read opens reject sym...
- Local agents pass `settingSources: ["all"]` by default so Cursor MCP servers, plugin tools, project/user settings, and related Cursor-native capabilities are available. Users can narrow loading with a comma-separated list such as `PI_CURSOR_SETTING_SOURCES=project,user,plugins`, or disable ambient Cursor setting sources with `PI_CURSOR_SETTING_SOURCES=none`. `/cursor-refresh-config` calls the current pooled SDK agent's `agent.reload()` to refresh filesystem Cursor config without recreating the agent. The provider suppresses direct Cursor SDK bootstrap stdout/stderr/console noise so it does not pollute the OMP TUI.
- On `cursor-sdk/*` models, omp-cursor removes only OMP-generated `<project_instructions>` blocks that overlap the effective Cursor `settingSources`: `user` for `~/.omp/agent/AGENTS.md`; `project` for discovered repo/parent `AGENTS.md` and `CLAUDE.md` (verified Cursor behavior: local agents load project `AGENTS.md` and `CLAUDE.md`). `~/.omp/agent/CLAUDE.md` is not removed (Cursor user layer uses `~/.claude/CLAUDE.md`). Blocks are removed by exact OMP serialization match from structured `contextFiles` via ...
- Cursor SDK models are treated as thinking-capable even when OMP reports `thinking=no`; that OMP column only means the SDK did not expose an OMP-controllable thinking parameter for that model.
- Cursor-side thinking remains visible through OMP's native thinking rendering when the Cursor SDK emits thinking or summary deltas.
- Local Cursor agents get two tool surfaces. First, Cursor keeps the Cursor SDK local-agent tool surface plus configured Cursor settings, plugins, and Cursor MCP servers. Second, omp-cursor can expose active OMP tools through a tokenized loopback MCP bridge, but the bridge is off by default and requires `PI_CURSOR_PI_TOOL_BRIDGE=1`.
- `buildCursorPiToolBridgeSnapshot()` is the runtime capability source for OMP bridge tools. It snapshots active OMP tools, carries per-tool `promptGuidelines` into bridge MCP descriptions, filters internal replay names, hides overlapping built-in OMP tools (`read`, `bash`, `write`, `edit`, `grep`, `find`, `ls`) unless `PI_CURSOR_EXPOSE_BUILTIN_TOOLS=1`, and creates collision-safe MCP names such as `pi__sem_reindex`. Cursor discovers the current run's exposed bridge too...
- Prompt text is the primary provider/bridge contract. Bootstrap prompts carry a short boundary block plus the callable-surface manifest by default (`PI_CURSOR_TOOL_MANIFEST=1`). MCP `listTools` descriptions use a one-line pointer to the bootstrap prompt instead of repeating the full contract. Cursor must call the exposed `pi__*` MCP name, not the real OMP tool name shown in OMP history or transcripts. When exposed, `pi__mcp` takes preference over Cursor-configur...
- The provider also registers `cursor_ask_question` for Cursor models when the bridge is enabled and the `PI_CURSOR_ASK_QUESTION` control is enabled by default. While the tool awaits OMP UI input it emits package event `omp-cursor:ask-question:blocked` with `{ active: true }` and clears `{ active: false }` in `finally`; the tool runs with `executionMode: "sequential"` so parallel sibling calls cannot overlap dialogs. Cursor sees it as `pi__cursor_ask_question`, and OMP executes it through the normal tool path.
- The bridge queues MCP calls, emits provider `toolcall_*` events, waits for matching OMP `toolResult` messages by `toolCallId`, resolves the result back into the same live Cursor SDK run without creating a new `Agent`, and never calls tool `execute()` handlers directly. The same-run resume invariant holds unless the run was disposed, aborted, or cancelled.
- Cursor SDK MCP tool calls use a guarded timeout override because installed `@cursor/sdk` 1.0.27 still has a 60-second MCP request default with no public per-server timeout option. The extension extends the verified Cursor SDK MCP `callTool` timeout path to 3600 seconds by default and shortens the verified first-send MCP initialize/listTools timeout paths to 10 seconds by default so unavailable configured MCP servers do not block the first reply for a full minute; unknown MCP protocol timeout stacks keep the SDK default. Users can override tool-call timeouts with `PI_CURSOR_MCP_TOOL_TIMEOUT_MS` or `PI_CURSOR_MCP_TOOL_TIMEOUT_SECONDS`, and initialize/listTools timeouts with `PI_CURSOR_MCP_CONNECT_TIMEOUT_MS` or `PI_CURSOR_MCP_CONNECT_TIMEOUT_SECONDS`. Bridged `CallTool` waits also have a local fail-closed deadline that defaults to and cannot exceed the effective MCP tool timeout; `PI_CURSOR_PI_BRIDGE_CALL_TIMEOUT_MS` can lower it, expiry or MCP cancellation aborts active pi execution when available, and expired bridge events are dropped before pi tool emission.
- Cursor SDK local safety controls are off by default. `--cursor-auto-review` / `PI_CURSOR_AUTO_REVIEW` and `--cursor-sandbox` / `PI_CURSOR_SANDBOX` pass only explicit enabled values into `Agent.create({ local })`; user or trusted project config can set `local.autoReview` and `local.sandboxOptions.enabled`; project config is active only when OMP's project-trust flow reached the extension and approved the project or the run used explicit `--auto-approve`, and project saves require the same immutable trust provenance.
- Local HTTP/1.1/SSE compatibility is strictly opt-in through `PI_CURSOR_HTTP_1_1`, `/cursor-http on|off|toggle`, or user `cursor-sdk.json` `local.useHttp1ForAgent`. Precedence is session, environment, user, then the built-in unset default; project config is excluded. Unset makes no `Cursor.configure()` call. Explicit values configure the installed SDK before local `Agent.create()`, extension-owned explicit state is cleared with the SDK's documented `null` reset when returning to unset and during session...
- Bridge diagnostics are opt-in only: `PI_CURSOR_PI_TOOL_BRIDGE_DEBUG=1` writes typed, allowlisted, scrubbed single-line JSONL records to `process.stderr` with prefix `[omp-cursor:bridge]`. Diagnostics are scrubbed operational logs, not anonymous telemetry. They intentionally include tool names, safe correlation IDs, run lifecycle, exposed OMP↔MCP name pairs, queued requests, result resolution, rejection, cancellation, and pending counts. Correlation IDs are generated independently from the tokenized...
- This repo does not provide a generic desktop-automation, browser-driver, or CDP recipe. Provider docs should describe omp-cursor's Cursor provider/bridge contract only.
- Cursor internal tool activity is recorded from SDK events and scrubbed. Maintainer reference for `@cursor/sdk@1.0.27` `ToolType` values, runtime alias normalization, and intentional mapping/fallback rules: [Cursor native tool replay — SDK ToolType replay matrix](./cursor-native-tool-replay.md#sdk-tooltype-replay-matrix) (official SDK docs: https://cursor.com/docs/sdk/typescript). In TUI sessions and structured JSON/RPC modes, supported completed `read`, `bash`, `grep`, `find`, `ls`, `edit`, `write`, ...
- Cursor native replay uses one neutral replay tool name, `cursor`, plus native-compatible card names when renderer-compatible (`read`, `bash`, `grep`, `find`, `ls`, `edit`, `write`). Neutral replay identity lives in `activityTitle`, `activitySummary`, and typed replay details, not in extra registered tool names. Bridge MCP names such as `pi__sem_reindex` are MCP-only; OMP session output uses real OMP tool names.
- Local Cursor SDK usage events are used when the SDK reports them before the corresponding OMP turn is emitted and the reported counts fit the selected OMP model window. For each safe local SDK-attributed assistant turn, `usage.input`, `usage.output`, `usage.cacheRead`, and `usage.cacheWrite` come from the latest per-turn raw `turn-ended.usage`.
- Audit observation, 2026-05-19, superseded by the 2026-05-21 replay pass and #68 incomplete visibility, then narrowed by the 2026-05-26 fast-local suppression: a missing-file read with Composer 2.5 emitted `tool-call-started` for Cursor `read`, then streamed final text `Error: File not found`, but did not emit `tool-call-completed` or an `onStep` `toolCall` error result. Leftover external/side-effectful started calls are surfaced at run completion through the same native replay routing as completed tools (activity cards when allowed, otherwise inactive/transcript traces), while fast local discovery starts are debug-only after a successful text-producing run. Cursor-reported completed/step errors remain visible.
- Maintainer visual verification for replay-card changes should follow [Cursor Native Tool Visual Audit Workflow](./cursor-native-tool-visual-audit.md): offscreen PTY-driven OMP run, xterm.js/Playwright screenshot rendering, and JSONL inspection before accepting commits or PRs.
- Cursor provider/runtime releases must pass the local [Platform Smoke Gate](./platform-smoke.md): `npm run smoke:platform:all`. Cloud-runtime changes must also pass `npm run smoke:cloud`. Use [Cursor Live Smoke Checklist](./cursor-live-smoke-checklist.md) only for focused inner-loop/debug runs with real `omp --auto-approve -e . --cursor-no-fast --model cursor-sdk/grok-4.6` invocations, manual observation, temporary session dirs, diagnostics scans, and persisted JSONL inspection. See [Cursor testing lessons](./cursor-testing-lessons.md) for evidence requirements.
- For models without a catalog `context` parameter, context windows are not hardcoded. The extension ships a bundled SDK-derived default/non-Max cache generated from `createAgentPlatform().checkpointStore.loadLatest(agentId).tokenDetails.maxTokens`. Successful runs can update a local override cache, but model discovery does not probe models at startup.
- Max Mode context windows are distinct from default/non-Max context windows. `@cursor/sdk` 1.0.27 documentation says the SDK may enable Max Mode automatically when a selected model requires it, but the public local-agent `ModelSelection` path still does not expose a manual Max Mode selector. Do not advertise Max Mode context windows unless the SDK catalog exposes an exact parameter/variant or the SDK public API adds a Max Mode selector that the extension actually sends.
- The installed `@cursor/sdk` exposes latest-style `ModelListItem.aliases`. The extension registers only unambiguous aliases as OMP model IDs (with the same context suffixes when applicable) and sends the alias back in `ModelSelection.id`. Cursor-only fast preferences are keyed by the selected SDK model ID/alias, with read fallback for older preferences keyed by the underlying catalog `id`. Aliases shared by multiple base models are skipped because the OMP row metadata would otherwise imply one base model while Cursor may resolve the alias to another.
- Local restart resume treats user entries already present at `session_start` or selected by tree navigation as crash-ambiguous: an older SDK handle cannot span them because the prior process may already have submitted that prompt. A user entry appended after startup in the current process may span the last completed handle for the normal next send.
- Persisted OMP sessions use a session-scoped Cursor SDK SQLite store at `<getDefaultSdkStateRoot(cwd)>/omp-sessions/<session-hash>/`; create/resume, transcript reads, checkpoint lookup, and exact-ID cleanup all receive that same store. Fileless acquisitions use unique OS-temporary stores that are removed on graceful disposal; invalidation starts a fresh agent instead of reopening a disposed temporary store. Resume entries version the store identity.
- Session-scoped Cursor SDK agent pooling reuses one live `@cursor/sdk` agent across compatible follow-up turns within the same OMP session scope. Each distinct local agent whose `Agent.send()` is initiated is best-effort recorded once per OMP session as a non-resumable `cursor-sdk-agent-lineage` custom entry. Cloned/forked sessions record lineage under their own OMP session ID.
- OMP steering/follow-up delivery can arrive while a split live Cursor SDK run is still active. The provider tracks the active live run per session scope and resumes it instead of calling `Agent.send()` again; stale old-run activity is cancelled when newer user input supersedes it.

## Goal

Make Cursor models feel native in OMP by leaning on OMP's existing model, thinking, footer, and session behavior instead of building a parallel Cursor parameter system.

Main outcomes:

- `omp models cursor-sdk` shows OMP-native Cursor models with accurate `contextWindow`, OMP-controllable thinking metadata, and conservative defaults where the Cursor SDK does not expose limits or capabilities.
- `shift+tab` is OMP's native thinking control and drives Cursor `reasoning` or `effort`.
- Cursor context options are represented as OMP-visible model variants when they change native model metadata.
- Cursor-only state (`fast` and Cursor SDK `mode`) is controlled by extension flags/commands and shown through native status text only when non-default.
- The default OMP footer remains intact.
- Model capabilities are discovered from the Cursor SDK, not hardcoded per model.

Native tradeoff: context-capable Cursor models intentionally use context-qualified OMP model IDs. This gives up one completely clean row per Cursor base model, but it lets OMP's native `contextWindow`, footer context usage, context overflow checks, compaction behavior, session restore, model selection, and `omp models cursor-sdk` metadata stay accurate.

## Non-goals

Not building now:

- verbosity support
- custom UI panels
- generic OMP model-parameter system for all providers
- full custom footer replacement
- independent Claude `thinking` toggle separate from OMP thinking
- multi-parameter CLI suffixes such as `--model cursor-sdk/gpt-5.5:medium:272k:fast`

## Source of Truth

Cursor SDK is the source of truth for Cursor model IDs and Cursor-supported parameters.

At startup, the extension calls:

```ts
Cursor.models.list({ apiKey });
```

Startup discovery resolves `apiKey` from `CURSOR_API_KEY`, then `apiKey` in the global user config `~/.omp/agent/cursor-sdk.json` (or `$PI_CODING_AGENT_DIR/cursor-sdk.json`).

The fixed-config key is user-scoped only; project `.omp/cursor-sdk.json` is never an auth source. Startup never parses `process.argv`; OMP remains the sole owner of CLI model/provider/key parsing. Provider turns keep OMP's resolved `options.apiKey`, with the same runtime fallback when no concrete caller key is supplied. No `auth.json` is read or written.

For each model, use:

- `model.id`
- `model.aliases`
- `model.displayName`
- `model.parameters`
- `model.variants`
- default variant: `variant.isDefault === true`, else first variant

This means new Cursor models and changed Cursor parameters are picked up after `/cursor-refresh-models`, reload, or restart.

OMP model metadata is also a source of truth for OMP-native behavior:

- `ProviderModelConfig.id`
- `ProviderModelConfig.name`
- `ProviderModelConfig.reasoning`: means OMP-controllable thinking, not whether a Cursor model is thinking-capable
- `ProviderModelConfig.thinkingLevelMap`
- `ProviderModelConfig.contextWindow`
- `ProviderModelConfig.maxTokens`
- `ProviderModelConfig.input`

If a Cursor parameter changes any of those OMP-native fields, model registration must expose that change to OMP.

### Refresh Current Cursor Matrix

Before releases, compare the generated fallback with the authenticated live catalog:

```bash
CURSOR_API_KEY="your-key" npm run check:cursor-snapshots
```

Run this whenever Cursor releases or changes models:

```bash
CURSOR_API_KEY="your-key" npm run refresh:cursor-snapshots -- --write
```

That command refreshes `src/cursor-fallback-models.generated.ts` only. If live local Cursor runs have collected checkpoint-derived context windows, merge them into the bundled default/non-Max snapshot too:

```bash
CURSOR_API_KEY="your-key" npm run refresh:cursor-snapshots -- --write \
  --context-windows ~/.omp/agent/cursor-sdk-context-windows.json
```

Both modes call `Cursor.models.list({ apiKey })` and use the same sanitizer and stable sort. `--check` byte-compares `src/cursor-fallback-models.generated.ts` without writing; `--write` refreshes it and updates `src/bundled-context-windows.ts` only when `--context-windows` is provided. Context-window inputs are limited to current selectable model IDs; redundant default `:fast`/`:slow` aliases collapse to one key, conflicting equivalent selections fail generation, and stale or ambiguous aliases are omitted. Generated provenance and command output record the installed `@cursor/sdk` version and model count. The script prints model IDs/counts only and scrubs known auth material from SDK errors; it must not print or store API keys. Review generated diffs before committing because Cursor can change aliases, defaults, and parameter meanings.

Dated evidence for Cursor's assistant-visible, model-specific system text and reconstructed tool guidance lives in [the historical evidence bundle](https://github.com/fitchmultz/pi-cursor-sdk/blob/main/docs/evidence/cursor-system-prompts-2026-08-02/README.md). Keep that evidence separate from omp-cursor's own bootstrap prompt: Cursor persists its base system message in the local SDK checkpoint, while this extension sends OMP context and bridge instructions as user content.

## Design Direction

Use native OMP abstractions wherever possible:

| Concern | Representation |
|---|---|
| Cursor base model | OMP provider model |
| Cursor `context` | OMP-visible model variant because it changes `contextWindow` |
| Cursor `reasoning` | OMP native thinking via `thinkingLevelMap` |
| Cursor `effort` | OMP native thinking via `thinkingLevelMap` |
| Cursor `thinking=false` | OMP native `off` |
| Cursor `fast` | extension state plus `:fast` / `:slow` virtual aliases for per-agent overrides |
| Cursor SDK `mode` | extension session state; `agent` by default, `plan` via SDK-native mode |
| Footer | default OMP footer plus optional extension status |

Reason:

- OMP already persists model and thinking selection.
- OMP already clamps unsupported thinking levels from `thinkingLevelMap`.
- OMP context display, context overflow, and compaction depend on `contextWindow`.
- extension APIs can replace the whole footer but cannot partially mutate the default model text.

## Model Registration

Register a `cursor` provider with `omp.registerProvider()`.

Rules:

- Register one OMP model for each Cursor base model and each unambiguous SDK alias when there is no Cursor `context` parameter.
- Register one OMP model per Cursor `context` value for each Cursor base model and each unambiguous SDK alias when the model exposes a `context` parameter.
- Skip SDK aliases that collide with another base model ID or are shared by multiple base models; those aliases can resolve differently from the OMP row metadata.
- Do not encode `reasoning`, `effort`, `thinking`, or Cursor SDK `mode` into OMP model IDs. For models with a Cursor `fast` parameter, also register selection-only `:fast` and `:slow` virtual model aliases that do not change OMP-native metadata.
- Prefer stable, readable `@<context>` suffixes that do not conflict with OMP's final `:<thinking>` suffix parser.
- Sort Cursor models by base ID, then context value in Cursor SDK order before calling `omp.registerProvider()`. Registration order matters for `/model` display and model cycling; `omp models cursor-sdk` sorts output separately.

Recommended context-variant ID format:

```text
cursor-sdk/gpt-5.5@1m
cursor-sdk/gpt-5.5@272k
cursor-sdk/claude-opus-4-8@1m
cursor-sdk/claude-opus-4-8@300k
cursor-sdk/composer-2-5
cursor-sdk/composer-2-5:fast
cursor-sdk/composer-2-5:slow
cursor-sdk/grok-4.6
cursor-sdk/grok-4.6:fast
cursor-sdk/grok-4.6:slow
cursor-sdk/gpt-5.5@1m:fast
```

Avoid colon-based context IDs in the first implementation unless this spec is intentionally changed:

```text
cursor-sdk/gpt-5.5:1m
cursor-sdk/gpt-5.5:1m:medium
```

Those can work technically because OMP parses only the final `:<thinking>` suffix, but they overload OMP's documented thinking shorthand.

Avoid this old parameter encoding:

```text
cursor-sdk/gpt-5.5:context=1m;fast=false;reasoning=medium
cursor-sdk/claude-opus-4-8:context=1m;effort=xhigh;thinking=true
```

Reason:

- `@1m` keeps context visually separate from OMP's native `:medium` thinking suffix.
- Context variants make `contextWindow` accurate in `omp models cursor-sdk`, the native footer, context overflow checks, and compaction logic.
- `:fast` / `:slow` are virtual aliases, not separate Cursor SDK base models: they keep the same context/thinking metadata and only force the outgoing Cursor `fast` param. They exist so subagents and workflow-spawned agents can choose fast/slow without mutating shared `/cursor-fast` defaults.

### Metadata Per Registered Model

Each registered model must set:

- `id`: context-qualified OMP model ID when needed. For SDK aliases, this uses the alias as the OMP-visible ID and the alias is sent back to Cursor as `ModelSelection.id`.
- `name`: human-readable Cursor display name plus context when useful.
- `reasoning`: `true` only if a Cursor `reasoning`, `effort`, or `thinking` parameter can map to OMP thinking. This controls OMP's thinking UI and `omp models cursor-sdk` `thinking` column; it must not be used to claim whether the Cursor model can think internally. Cursor SDK models are thinking-capable even when this is `false`.
- `thinkingLevelMap`: model-specific OMP-to-Cursor mapping for OMP UI, clamping, persistence, and footer display.
- `contextWindow`: parsed from context variant, else conservative fallback.
- `maxTokens`: conservative explicit value until Cursor SDK exposes output limits.
- `input`: supported input types. The installed Cursor SDK accepts `SDKUserMessage.images`, and Cursor models are expected to support image input, so advertise `["text", "image"]`.
- `cost`: zeroed unless reliable Cursor costs are available.

The extension stores runtime metadata in an internal map keyed by registered OMP model ID. That map records the Cursor base catalog model ID, the Cursor selection model ID (base ID or alias), selected context param, default params, and discovered capabilities. `ProviderModelConfig` has no dedicated metadata field, so do not rely on hidden custom fields for this state.

## Dynamic Capabilities

No per-model hardcoded control list.

Infer behavior from discovered params:

| Cursor param | Extension behavior |
|---|---|
| `context` with values | register OMP-visible context variants |
| `reasoning` | populate `thinkingLevelMap` |
| `effort` | populate `thinkingLevelMap` |
| `thinking` with `true/false` | map `false` to OMP `off`; map `true` to the enabled OMP level chosen for boolean-only thinking |
| `fast` with `true/false` | enable fast extension setting |

Unsupported Cursor-only actions are no-op plus a short notification.

Example:

```text
Fast mode not supported by gemini-3.1-pro
```

## Keybindings And Commands

Native OMP keybindings:

| Action | Keybinding | Owner |
|---|---:|---|
| Cycle thinking / reasoning / effort | `shift+tab` | OMP native `app.thinking.cycle` |
| Select model / context variant | `/model`, `ctrl+l`, scoped model cycling | OMP native model selection |

Cursor extension controls:

| Action | Preferred control | Applies when |
|---|---:|---|
| Toggle fast | `/cursor-fast` | model has `fast` |
| Set SDK mode | `/cursor-mode agent\|plan` | Cursor model selected |
| Set local HTTP transport | `/cursor-http on\|off\|toggle` | local Cursor runtime |
| Refresh filesystem Cursor config | `/cursor-refresh-config` | Cursor model selected and an SDK agent may exist |
| Show tool surfaces (maintainer) | `/cursor-tools` | Cursor model selected |

Do not register a shortcut for `shift+tab`. OMP reserves the native thinking keybinding, and the extension should only influence it through model metadata.

Do not add a context-cycle shortcut in the first pass. Context is an OMP model variant, so users should change it through native model selection/cycling.

## Thinking / Reasoning / Effort Mapping

Important distinction:

- **Cursor thinking support** applies to all Cursor SDK models. The extension should assume Cursor models can think and may emit thinking deltas.
- **OMP-controllable thinking** means Cursor exposes a `reasoning`, `effort`, or `thinking` parameter that the extension can set from OMP's native thinking level. These models register `reasoning: true` and show `thinking=yes` in `omp models cursor-sdk`.
- **Cursor SDK thinking-control gap** means the model can still think, but the SDK does not expose a user-controllable thinking parameter for that model. These models register `reasoning: false` and show `thinking=no` in `omp models cursor-sdk` because OMP cannot control a level for them. The extension still surfaces Cursor `thinking-delta` and summary events through OMP's native thinking rendering when they are emitted.

Do not mark a model `reasoning: true` only because it can think. That would make OMP show controls such as `--thinking`, `:medium`, and shift+tab even though the extension cannot translate them into Cursor SDK params.

OMP levels:

```text
off, minimal, low, medium, high, xhigh, max
```

Cursor values vary by model. Build `thinkingLevelMap` from the values Cursor exposes.

Mapping rules:

| OMP level | Cursor value preference |
|---|---|
| `off` | `none`, else `off`, else `false`, else unsupported |
| `minimal` | `minimal`, else unsupported |
| `low` | `low` |
| `medium` | `medium` |
| `high` | `high`, else `true` for boolean-only thinking |
| `xhigh` | `xhigh`, else `extra-high` |
| `max` | `max` |

Important details:

- Use `null` for unsupported OMP levels so OMP hides/skips/clamps them natively.
- Include `xhigh` and `max` only when Cursor exposes real values for them.
- Keep `xhigh` and `max` distinct. Cursor exposes both on some models, while `extra-high` remains an `xhigh` alias.
- If Cursor exposes `reasoning=none`, map OMP `off` to `none`.
- If Cursor exposes `thinking=false`, map OMP `off` to `false`.
- `thinkingLevelMap` does not create Cursor SDK params by itself. It only controls OMP-native behavior. The Cursor stream implementation must use the active OMP thinking level plus the extension's discovered Cursor metadata to build `ModelSelection.params` for `Agent.create()`.

For boolean-only `thinking`, unsupported OMP levels must be explicit `null`; otherwise OMP treats omitted non-`xhigh`/`max` levels as supported. Use this shape unless Cursor exposes richer values:

```ts
{
  off: "false",
  minimal: null,
  low: null,
  medium: null,
  high: "true",
  xhigh: null,
  max: null,
}
```

## Claude Behavior

Some Claude models support both:

```text
thinking=true|false
effort=low|medium|high|xhigh|max
```

Rules:

- OMP `off` sends `thinking=false`.
- OMP enabled levels send `thinking=true` and the mapped `effort`.
- `shift+tab` changes OMP thinking, which changes Cursor `effort`.
- There is no separate `thinking` toggle.

Reason:

- This matches OMP's single thinking mental model.
- It avoids an independent Cursor `thinking` state that the native footer, CLI, and session thinking persistence cannot represent.
- Users can still disable Claude thinking with OMP `off`.

## Context Behavior

If a Cursor model supports `context`, register one OMP model variant per context value.

Examples:

```text
cursor-sdk/gpt-5.5@272k
cursor-sdk/gpt-5.5@1m

cursor-sdk/claude-opus-4-8@300k
cursor-sdk/claude-opus-4-8@1m
```

Each variant must:

- have an entry in the extension metadata map that points back to the same Cursor base model ID,
- include the selected Cursor `context` param when calling `Agent.create()`,
- set OMP `contextWindow` from that context value,
- share the same `thinkingLevelMap` as the base model unless Cursor reports otherwise.

Reason:

- OMP context display and overflow logic must match the actual Cursor context.
- OMP has no generic provider-parameter system that can change `contextWindow` while keeping the same model ID.

## Fast Behavior

If a model supports `fast`:

```text
fast=false <-> fast=true
```

Rules:

- Unsuffixed models use extension state from `/cursor-fast`, per-session entries, and global defaults.
- `:fast` / `:slow` virtual model aliases force fast on/off for that selected agent and override saved defaults without writing state.
- Toggle unsuffixed models with `/cursor-fast`; do not persist a new default while a virtual fast alias is selected.
- Store per-session and global per-base-model preferences for unsuffixed models.
- When calling `Agent.create()` or `agent.send()`, include the selected `fast` value in Cursor model params.
- Show fast-capable local models as `cursor:local · fast:on` or `cursor:local · fast:off` through `ctx.ui.setStatus()` while a Cursor model is active; cloud runtime shows `cursor:cloud · fast:n/a`.
- Keep `--cursor-fast` and `--cursor-no-fast` as explicit process-level force flags.

Reason:

- `fast` does not affect OMP `contextWindow`, thinking levels, or input support.
- The virtual aliases trade small `omp models cursor-sdk` noise for per-agent selection that works with subagents and dynamic workflows, where mutating a shared global fast default is the wrong abstraction.

Status examples:

```text
cursor:local · fast:off
cursor:local · fast:on
cursor:local · fast:on · http1
```

## Cursor SDK Mode Behavior

Current Cursor SDK exposes SDK-native conversation mode:

```ts
type AgentModeOption = "agent" | "plan";
```

Rules:

- Default mode is `agent`.
- Supported modes are exactly `agent` and `plan`.
- Mode is extension session state, not a model variant, not OMP thinking/reasoning, not Cursor `fast`, and not OMP's separate plan-mode extension.
- `--cursor-mode agent|plan` sets a one-run CLI override and does not append session state.
- `/cursor-mode agent` and `/cursor-mode plan` persist session mode with `omp.appendEntry()`.
- `/cursor-mode` with no args reports current mode and usage.
- Invalid CLI values fail non-UI runs and notify interactive users before the provider rejects the run.
- New SDK agents are seeded with `Agent.create({ mode })`.
- Every SDK send passes the effective mode through `agent.send(..., { mode })` so `/cursor-mode` and `--cursor-mode` remain the source of truth.
- Mode is not part of the session-agent pool key because Cursor SDK supports SDK-native per-send mode switches.
- Cursor plan/todo/task/mode activity remains display-only Cursor activity unless OMP itself exposes a native state path. Replay cards do not mutate OMP plan/todo state or active tools.

Status examples:

```text
cursor:local · fast:n/a · plan
cursor:local · fast:off · plan
cursor:local · fast:on · plan
cursor:cloud · fast:n/a · plan
```

## Footer Behavior

Hard requirement:

- Leave OMP's default footer intact.
- Do not use `ctx.ui.setFooter()` for the first pass.
- Use `ctx.ui.setStatus()` only while a Cursor model is active, showing Cursor-only state that OMP cannot show natively, such as `cursor:local`, `cursor:cloud`, local `fast:on|off|n/a`, enabled local `http1`, and non-default Cursor SDK `plan` mode.
- Non-cursor models must have no Cursor status.

Reason:

- `ctx.ui.setFooter()` replaces the entire built-in footer.
- OMP has no public extension API to mutate only the model text in the default footer.
- Reimplementing the default footer would create drift with OMP's native footer behavior.

Expected native footer behavior:

- provider/model is shown by OMP from the selected `cursor` model,
- thinking level is shown by OMP when `reasoning` is true,
- context usage is computed from `contextWindow`,
- extension status adds only Cursor-only text such as `cursor:local · fast:n/a`, `cursor:local · fast:off`, `cursor:local · fast:on · http1`, `cursor:local · fast:on · plan`, or `cursor:cloud · fast:n/a`.

`ctx.ui.setStatus()` adds an extension status line in the default footer. It does not patch the built-in model segment. The native shape is closer to:

```text
...                                      (cursor) gpt-5.5@1m • medium
cursor:local · fast:off · plan
```

not:

```text
(cursor) gpt-5.5 • 1M • medium • fast
```

## State And Persistence

Match OMP's native mental model:

### Native OMP state

Let OMP persist:

- selected model, including context variant,
- selected thinking level,
- session model restore,
- global default thinking behavior.

### Extension state

The extension persists only Cursor-only state:

- `fast` per session,
- `fast` global default per selected Cursor SDK model ID or alias,
- Cursor SDK `mode` per session,
- local HTTP transport per session and user default,
- any future Cursor-only parameter that does not map to OMP model metadata.

Use:

- `omp.appendEntry()` for session state that must survive resume/fork/reload,
- an extension-owned global config file for cross-session defaults,
- in-memory state only as a cache rebuilt from persisted state on `session_start`.

### New Install

Use Cursor default variants:

```text
gpt-5.5 -> cursor-sdk/gpt-5.5@1m, thinking medium, fast=false
composer-2.5 -> cursor-sdk/composer-2-5, fast=true
grok-4.6 -> cursor-sdk/grok-4.6, fast=true
```

### Resume Session

Restore:

- OMP model, including context variant,
- OMP thinking level,
- session Cursor-only state such as `fast`, Cursor SDK `mode`, and local HTTP transport.

### New Session

Use:

1. OMP's selected/default model and thinking level,
2. branch HTTP transport state, then explicit environment, then the user-level HTTP default,
3. global fast defaults for the selected SDK model ID or alias, falling back to older base-model keys,
4. else Cursor default variant params.

## CLI / Print Mode

Guaranteed first-pass support:

```bash
omp --model cursor-sdk/gpt-5.5@1m --thinking medium
omp --model cursor-sdk/gpt-5.5@1m --cursor-mode plan
omp --model cursor-sdk/gpt-5.5@1m:medium
omp --model cursor-sdk/gpt-5.5@272k:xhigh
```

These use OMP's native thinking parser. `--thinking` wins over a `:<thinking>` suffix when both are present.

Not first-pass support:

```bash
cursor-sdk/gpt-5.5:medium:272k:fast
```

Reason:

- OMP supports one final `:<thinking>` suffix.
- Cursor-only parameters are not generic OMP CLI parameters.
- Context is already represented by the registered OMP model ID.
- `fast` is controlled by saved extension defaults, `:fast` / `:slow` virtual model aliases, or the `--cursor-fast` / `--cursor-no-fast` extension flags.
- Cursor SDK `mode` is controlled by `/cursor-mode` session state or the first-pass `--cursor-mode` extension flag; it is never encoded in `--model`.

For print mode:

- no keybindings,
- use selected context model variant,
- use `--thinking` or `:medium` for reasoning/effort,
- use saved global `fast` defaults unless a virtual `:fast` / `:slow` model alias or force flag is present,
- use Cursor SDK `agent` mode unless `/cursor-mode` session state or `--cursor-mode` overrides it.

Fast flag example:

```bash
omp --model cursor-sdk/gpt-5.5@1m --cursor-fast -p "Say ok only"
```

## Discovered Model Capability Examples

These examples document the capability shapes the extension handles, not an exhaustive live catalog. The exact Cursor catalog changes over time; use `omp models cursor-sdk -e .` or `Cursor.models.list()` for the current model surface. When the SDK reports aliases, only unambiguous aliases are registered; shared generic aliases are skipped.

| Example model shape | Cursor controls | OMP representation |
|---|---|---|
| plain model, such as `default` or models with no exposed controls | none | plain model |
| Composer-style model such as `composer-2.5` or `composer-2` | fast | plain model + fast extension state |
| GPT-style reasoning model with context variants | context, reasoning, fast when exposed | context variants + native thinking + optional fast state |
| Claude-style thinking model with context variants | thinking, context, effort when exposed | context variants + native thinking + optional fast state |
| Claude-style thinking model without context variants | thinking and/or effort | plain model + native thinking |
| context-only model | context | context variants |
| unique latest alias for any shape | aliases | same OMP rows as the base model shape, using the alias as `ModelSelection.id` |
| shared generic alias across multiple base models | aliases | skipped to avoid misleading OMP rows |

If Cursor later adds `fast`, `context`, `reasoning`, `effort`, or aliases to a model, the extension picks up unambiguous capability changes dynamically.

## Detailed Examples

### Composer 2 / 2.5

Initial Cursor default for Composer 2.5:

```text
OMP model: cursor-sdk/composer-2-5
Cursor params: fast=true
OMP thinking: off
Cursor status: cursor:local · fast:on
```

Toggle fast:

```text
Cursor params: fast=false
Cursor status: cursor:local · fast:off
```

`shift+tab`: no-op because the model is not reasoning-capable.

### `gpt-5.5`

Initial Cursor default:

```text
OMP model: cursor-sdk/gpt-5.5@1m
Cursor params: context=1m; reasoning=medium; fast=false
OMP thinking: medium
Cursor status: cursor:local · fast:off
```

After selecting the 272k variant:

```text
OMP model: cursor-sdk/gpt-5.5@272k
Cursor params: context=272k; reasoning=medium; fast=false
OMP contextWindow: 272000
```

After fast toggle:

```text
Cursor params: context=272k; reasoning=medium; fast=true
Cursor status: cursor:local · fast:on
```

After `shift+tab` to xhigh:

```text
OMP thinking: xhigh
Cursor params: context=272k; reasoning=extra-high; fast=true
```

### `gpt-5.3-codex`

Initial Cursor default:

```text
OMP model: cursor-sdk/gpt-5.3-codex
Cursor params: reasoning=high; fast=true
OMP thinking: high
Cursor status: cursor:local · fast:on
```

After `shift+tab` to low:

```text
OMP thinking: low
Cursor params: reasoning=low; fast=true
```

No context variant.

### `claude-opus-4-8`

Initial Cursor default:

```text
OMP model: cursor-sdk/claude-opus-4-8@1m
Cursor params: thinking=true; context=1m; effort=xhigh
OMP thinking: xhigh
```

After selecting the 300k variant:

```text
OMP model: cursor-sdk/claude-opus-4-8@300k
Cursor params: thinking=true; context=300k; effort=xhigh
OMP contextWindow: 300000
```

After `shift+tab` to high:

```text
OMP thinking: high
Cursor params: thinking=true; context=300k; effort=high
```

After `shift+tab` to off:

```text
OMP thinking: off
Cursor params: thinking=false; context=300k
```

### `grok-4.5`

Supports `effort=low|medium|high` and `fast=false|true`; it does not advertise context variants.

```text
cursor-sdk/grok-4.5
```

Fast toggle maps to the Cursor `fast` parameter.

`shift+tab` maps the available low, medium, and high levels to Cursor `effort`; levels without a catalog value do not invent one.

### `grok-4.6`

Supports `effort=low|medium|high|xhigh` and `fast=false|true`; it does not advertise context variants. The Cursor default variant is `effort=high` and `fast=true`.

```text
cursor-sdk/grok-4.6
cursor-sdk/grok-4.6:fast
cursor-sdk/grok-4.6:slow
```

Fast toggle maps to the Cursor `fast` parameter. `--cursor-no-fast` and `:slow` send `fast=false`.

`shift+tab` maps the available low, medium, high, and xhigh levels to Cursor `effort`; levels without a catalog value do not invent one.

## Validation Plan

Before calling done:

1. Unit tests:
   - context-variant model IDs
   - dynamic capability discovery
   - context variant registration and decoding
   - fast extension state and status behavior
   - Cursor SDK mode session/CLI state and status behavior
   - `reasoning` mapping
   - `effort` mapping
   - boolean `thinking` maps to OMP `off` / enabled levels
   - OMP `xhigh` preference order: `xhigh`, then `extra-high`
   - OMP `max` maps only to Cursor `max`
   - session restore for Cursor-only state
   - global default state for Cursor-only state
   - unsupported no-op notifications

2. Runtime checks:
   - `omp models cursor-sdk -e .`
   - confirm context variants show expected `context` column
   - launch interactive with Cursor
   - verify default OMP footer remains unchanged
   - verify Cursor status appears only for Cursor models
   - verify Cursor fast-capable local models show `cursor:local · fast:on` or `cursor:local · fast:off`
   - verify Cursor `plan` status appears only in non-default mode and combines with status as `cursor:local · fast:n/a · plan`, `cursor:local · fast:on · plan`, `cursor:local · fast:off · plan`, or `cursor:cloud · fast:n/a · plan`
   - verify non-cursor footer/status unchanged
   - verify `shift+tab` uses OMP native thinking
   - verify context changes through native model selection
   - verify resume restores model, thinking, and Cursor-only state

3. Print mode:
   - `omp --model cursor-sdk/gpt-5.5@1m:medium -p "Say ok only"`
   - `omp --model cursor-sdk/gpt-5.5@272k --thinking xhigh -p "Say ok only"`
   - `omp --model cursor-sdk/claude-opus-4-7@1m --thinking max -p "Say ok only"`
   - `omp --model cursor-sdk/gpt-5.5@1m --cursor-fast -p "Say ok only"`
   - `omp --model cursor-sdk/gpt-5.5@1m --cursor-mode plan -p "Say ok only"`
   - confirm requests use selected context, OMP thinking, fast flag state, and SDK-native mode

4. Tool bridge and replay:
   - `npm test -- test/cursor-pi-tool-bridge.test.ts test/cursor-pi-tool-bridge-call-timeout.test.ts test/cursor-provider-bridge-mcp.test.ts test/cursor-live-run-coordinator.test.ts test/cursor-mcp-timeout-override.test.ts`
   - confirm `Agent.create()` gets `mcpServers.pi_tools` when active OMP tools exist and omits it when `PI_CURSOR_PI_TOOL_BRIDGE=0` or the active snapshot is empty
   - confirm bridged MCP requests emit real OMP tool calls and resolve matching OMP tool results back to the same live Cursor SDK run without creating a new `Agent`, unless the run was disposed, aborted, or cancelled
   - confirm bridge MCP activity is suppressed from Cursor replay while non-bridge Cursor MCP activity remains visible
   - confirm `PI_CURSOR_MCP_TOOL_TIMEOUT_MS` and `PI_CURSOR_MCP_TOOL_TIMEOUT_SECONDS` override the Cursor SDK MCP callTool timeout seam
   - confirm `PI_CURSOR_PI_BRIDGE_CALL_TIMEOUT_MS` can only lower the bridge deadline; expiry and cancellation clear pending state and abort active OMP execution when available
   - confirm `PI_CURSOR_MCP_CONNECT_TIMEOUT_MS` and `PI_CURSOR_MCP_CONNECT_TIMEOUT_SECONDS` override the Cursor SDK MCP initialize/listTools timeout seam while unknown protocol timeout stacks keep the SDK default
   - confirm `PI_CURSOR_PI_TOOL_BRIDGE_DEBUG=1` emits typed, allowlisted, scrubbed JSONL to `process.stderr` with prefix `[omp-cursor:bridge]`
   - run the visual audit workflow when replay card visuals or bridge card visuals change; JSONL should show real OMP tool names for bridged calls and no duplicate MCP replay for bridge calls
