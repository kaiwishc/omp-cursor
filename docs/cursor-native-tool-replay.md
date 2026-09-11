# Cursor native tool replay

User-facing overview of callable vs display-only tools: [Cursor tool surfaces in OMP](./cursor-tool-surfaces.md).

omp-cursor has two separate OMP-facing paths plus Cursor's own local-agent tool surface:

1. **Local OMP MCP bridge:** off by default for local Cursor agents. Set `PI_CURSOR_PI_TOOL_BRIDGE=1` to expose the current OMP session's bridgeable active tools through a tokenized `127.0.0.1` MCP endpoint, excluding internal Cursor replay activity names and, by default, overlapping built-in OMP tools (`read`, `bash`, `write`, `edit`, `grep`, `find`, `ls`). When Cursor calls one of these MCP tools, OMP executes the real OMP tool through its normal tool path.
2. **Cursor native tool replay:** display-only. It renders completed Cursor SDK tool activity as OMP-native-looking cards using recorded Cursor results.

This document is about replay. Replay is not execution and is not the local OMP bridge.

## Live bridge vs replay

| Surface | Names Cursor can call | Names OMP shows | IDs | Execution behavior |
| --- | --- | --- | --- | --- |
| Local OMP MCP bridge | Live MCP names such as `pi__sem_reindex`, only when exposed in the current run | Real OMP tool names such as `sem_reindex` | Bridge run and tool IDs begin with `cursor-pi-bridge-*` | Real OMP execution through normal OMP `toolCall` / `toolResult` flow |
| Cursor native tool replay | None; replay names are not callable tools | Native-compatible card names or neutral Cursor activity labels | Replay IDs begin with `cursor-replay-*` | Display-only recorded Cursor results; no re-run, file mutation, MCP call, or OMP state mutation |
| Cursor-native host tools/settings/plugins/MCP | Cursor SDK local-agent tool names, as provided by Cursor | Only replay cards or transcript summaries when reported by the SDK | Cursor SDK-owned IDs | Neither OMP bridge nor replay execution; owned by the Cursor SDK local agent path |

Replay labels, replay cards, and transcript tool names are display-only/context-only. Bridge MCP names are also not OMP tool names: Cursor must call the exposed `pi__*` MCP name, while OMP history and cards use the real OMP tool name.

Cursor SDK `plan` mode (`--cursor-mode plan` or `/cursor-mode plan`) can make Cursor produce plan-oriented text and plan/todo activity. Replay still treats Cursor `createPlan`, `updateTodos`, task/mode, and related workflow activity as display-only Cursor activity. It does not switch OMP into plan mode, mutate OMP todos, or change OMP active tools.

## Local OMP bridge summary

The bridge is disabled by default. Set `PI_CURSOR_PI_TOOL_BRIDGE=1` when bridgeable active OMP tools should be exposed. Cursor sees bridge-owned MCP names such as `pi__sem_reindex`, while OMP history and tool cards use the real OMP tool name such as `sem_reindex`. The bridge hides overlapping built-in OMP tools by default because Cursor already has native equivalents; extension/custom tools and non-overlapping active tools present in the OMP active tool registry are exposed only after the bridge is enabled. `omp-cursor` also registers `cursor_ask_question` for Cursor models when the bridge is enabled and `PI_CURSOR_ASK_QUESTION` is left on, exposed to Cursor as `pi__cursor_ask_question`.

Rollback, timeout, and diagnostics controls:

```bash
PI_CURSOR_PI_TOOL_BRIDGE=1 PI_CURSOR_ASK_QUESTION=0 omp --model cursor-sdk/grok-4.6
PI_CURSOR_PI_TOOL_BRIDGE=1 omp --model cursor-sdk/grok-4.6
PI_CURSOR_PI_TOOL_BRIDGE=0 omp --model cursor-sdk/grok-4.6
PI_CURSOR_EXPOSE_BUILTIN_TOOLS=1 omp --model cursor-sdk/grok-4.6
PI_CURSOR_MCP_TOOL_TIMEOUT_SECONDS=7200 omp --model cursor-sdk/grok-4.6
PI_CURSOR_MCP_TOOL_TIMEOUT_MS=7200000 omp --model cursor-sdk/grok-4.6
PI_CURSOR_PI_BRIDGE_CALL_TIMEOUT_MS=120000 omp --model cursor-sdk/grok-4.6
PI_CURSOR_MCP_CONNECT_TIMEOUT_SECONDS=5 omp --model cursor-sdk/grok-4.6
PI_CURSOR_MCP_CONNECT_TIMEOUT_MS=5000 omp --model cursor-sdk/grok-4.6
PI_CURSOR_PI_TOOL_BRIDGE_DEBUG=1 omp --model cursor-sdk/grok-4.6
```

`PI_CURSOR_ASK_QUESTION=0` disables only `cursor_ask_question` / `pi__cursor_ask_question`, leaving the rest of the OMP bridge available; it is enabled by default. `PI_CURSOR_PI_TOOL_BRIDGE=0` disables the bridge, including `pi__cursor_ask_question`. `PI_CURSOR_EXPOSE_BUILTIN_TOOLS=1` opts in to exposing overlapping OMP tool names that Cursor already has native equivalents for. The installed Cursor SDK uses a 60-second MCP protocol default; omp-cursor overrides that seam by default with 3600 seconds for MCP `callTool` requests.

## What gets replayed

When Cursor reports completed tool activity, the extension can display recorded results for:

- `read`
- `bash`
- `grep`
- `find`
- `ls`
- `edit`
- `write`
- diagnostics
- delete
- todos and plans
- tasks
- image generation
- MCP activity
- semantic codebase search (`semSearch`)
- screen recording (`recordScreen`)
- web search and web fetch activity (when reported as replayable SDK `mcp` or host tool completions; not SDK `semSearch`)

Cursor `glob` activity is displayed through native `find` cards.

For the full `@cursor/sdk@1.0.27` `ToolType` set, disposition matrix, and runtime alias normalization, see [SDK ToolType replay matrix](#sdk-tooltype-replay-matrix) below. Official SDK reference: https://cursor.com/docs/sdk/typescript

Edit and write activity replays through OMP-facing `edit` and `write` cards only when replay arguments truthfully satisfy the matching OMP schema, but still uses recorded Cursor results only. The adapter passes through truthful Cursor paths, content when Cursor reported it, and recorded diff/details; it does not pretend Cursor's editing schema is OMP's schema and it fails closed if a recorded replay result is missing. Cursor `StrReplace` with recorded replacement text displays as native-looking `edit`; path-only Cursor `edit` and notebook edit activity fall back to neutral Cursor activity so OMP does not reject the replay before recorded-result handling. Cursor `write` displays as native-looking `write`. Diagnostics, delete, todos/plans, task/subagent, image, MCP, and web activity stay neutral Cursor activity.

## SDK ToolType replay matrix

Source of truth for SDK tool names: `@cursor/sdk@1.0.27` conversation `ToolType` values and https://cursor.com/docs/sdk/typescript

Implementation owners: `src/cursor-tool-presentation-registry.ts` (canonical names, labels, visibility, replay policy, bridge exclusions for internal replay wrappers, alias normalization, and display-spec key completeness), `src/cursor-transcript-tool-specs.ts` (registry-keyed display implementations for transcript formatting and OMP display builders), `src/cursor-native-tool-display-replay.ts` (replay card rendering derived from registry replay metadata), and `src/cursor-web-tool-activity.ts` (MCP/web alias remapping before display lookup).

**Maintainer invariants — edit/write replay previews:** All colored diff rendering (native `edit` cards and `Cursor edit` activity fallbacks) flows through the single `formatCursorReplayDiff()` in `src/cursor-native-tool-display-replay.ts`. Activity write fallbacks with structured `fileContentAfterWrite` use the same `formatCursorReplayFilePreview()` path as native `write` cards. Structured `diffString` (and `diff`/`lines*`) or `fileContentAfterWrite` on `CursorReplay*Details` (including activity variants) is the source of truth for TUI preview coloring/highlighting. `expandedText` on activity details is for summary/expansion and as a fallback when the current SDK reports a unified diff only in text; it is never the primary preview source when structured fields are present. No parallel +/- coloring loops exist.

This matrix covers **Cursor native tool replay only**. It does not describe the [live OMP MCP bridge](#live-bridge-vs-replay) or Cursor-native host tools, settings, plugins, and configured MCP servers from the Cursor SDK local-agent path.

| SDK `ToolType` | OMP disposition | OMP card / tool name | Notes |
| --- | --- | --- | --- |
| `read` | native replay | `read` | Recorded Cursor read results |
| `shell` | native replay | `bash` | SDK `shell` maps to OMP `bash` cards |
| `grep` | native replay | `grep` | |
| `glob` | native replay | `find` | Intentional mapping; not a missing `glob` replay bug |
| `ls` | native replay | `ls` | |
| `edit` | native replay or neutral activity | `edit` or `cursor` | Native `edit` only when recorded args satisfy OMP's `edit` schema; path-only or notebook edits fall back to neutral **Cursor edit** activity |
| `write` | native replay or neutral activity | `write` or `cursor` | Native `write` only when recorded content/path args satisfy OMP's `write` schema; otherwise neutral **Cursor write** activity |
| `delete` | neutral activity | `cursor` | Collapsed label **Cursor delete** |
| `readLints` | neutral activity | `cursor` | Collapsed label **Cursor diagnostics** |
| `updateTodos` | neutral activity | `cursor` | Collapsed label **Cursor todos**; display-only, does not drive OMP todos, including in Cursor SDK `plan` mode |
| `createPlan` | neutral activity | `cursor` | Collapsed label **Cursor plan**; display-only, does not drive OMP plan mode, including in Cursor SDK `plan` mode |
| `task` | neutral activity | `cursor` | Collapsed label **Cursor subagent** by default; summary includes description plus subagent kind/model/short ID when Cursor reports them; `PI_CURSOR_TASK_PRESENTATION=task` restores **Cursor task** wording |
| `generateImage` | neutral activity | `cursor` | Collapsed label **Cursor image generation** |
| `mcp` | neutral activity | `cursor` | Collapsed label **Cursor MCP** for non-web MCP completions; web search/fetch MCP `toolName` values reclassify to the rows below |
| `semSearch` | neutral activity | `cursor` | Collapsed label **Cursor semantic search**; semantic codebase search, not web search |
| `recordScreen` | neutral activity | `cursor` | Collapsed label **Cursor screen recording** |
| *(host/MCP alias)* `WebSearch` / `web_search` / similar | neutral activity | `cursor` | Collapsed label **Cursor web search**; display-only Cursor web access reported by the SDK, not an executable OMP web tool |
| *(host/MCP alias)* `WebFetch` / `web_fetch` / similar | neutral activity | `cursor` | Collapsed label **Cursor web fetch**; display-only Cursor web access reported by the SDK, not an executable OMP web tool |
| _(no spec; future/unknown SDK name)_ | neutral activity | `cursor` | Collapsed label **Cursor** plus SDK tool name via `buildGenericPiToolDisplay()`; bounded fallback transcript only |

**Unknown/future fallback path:** SDK tool names with no registry-backed display implementation entry use `buildGenericPiToolDisplay()` with bounded scrubbed fallback content. Lookup uses `Object.hasOwn()` so inherited keys cannot match a registry spec. When native replay is enabled, those completions queue through neutral OMP tool name `cursor`, not native OMP `read`/`bash` cards. Collapsed labels include the SDK tool name.

Neutral activity rows use OMP tool name `cursor` with `activityTitle` / `activitySummary` metadata. User-visible collapsed cards use labels like **Cursor semantic search**.

## Runtime alias normalization

Before display lookup, completed SDK tool names pass through `normalizeCursorToolName()` in `src/cursor-tool-presentation-registry.ts`; MCP web tool names are additionally remapped by `resolveTranscriptToolName()` in `src/cursor-web-tool-activity.ts`. Documented aliases:

| Runtime alias | Canonical SDK name |
| --- | --- |
| `read_file` | `read` |
| `list_dir` | `ls` |
| `run_terminal_cmd`, `terminal`, `bash`, `shell` | `shell` |
| `grep_search`, `search` | `grep` |
| `file_search` | `glob` |
| `write_file`, `writefile` | `write` |
| `strreplace`, `str_replace`, `str-replace`, `edit_file`, `editfile`, `edit_notebook`, `editnotebook`, `notebook_edit`, `notebookedit` | `edit` |
| `websearch`, `web_search`, `web-search` | `webSearch` (via `resolveTranscriptToolName()`) |
| `webfetch`, `web_fetch`, `web-fetch` | `webFetch` (via `resolveTranscriptToolName()`) |

Unlisted aliases keep their original name and fall through to the spec lookup or fallback transcript path. SDK `mcp` completions whose nested `toolName` is `WebSearch` / `web_search` / `WebFetch` / `web_fetch` (or `tool_name`) also resolve to `webSearch` / `webFetch` before display lookup.

## Intentional mappings and fallbacks

These behaviors are by design. They are not OMP replay execution bugs:

- **`glob` → `find`:** Cursor glob completions render as native OMP `find` cards.
- **`shell` → `bash`:** Cursor shell completions render as native OMP `bash` cards, including aliases normalized to `shell`.
- **`edit` / `StrReplace` / notebook edits:** native OMP `edit` cards only when recorded replay args truthfully satisfy OMP's `edit` schema; otherwise neutral **Cursor edit** activity so OMP validation does not reject the replay before recorded-result handling.
- **`write`:** native OMP `write` cards only when recorded content/path args satisfy OMP's schema; otherwise neutral **Cursor write** activity.
- **Plan/todo tools:** `createPlan` and `updateTodos` replay is display-only and does not drive OMP plan mode or OMP todo state, even when Cursor SDK mode is `plan`.
- **`semSearch`:** semantic codebase search activity, not web search.
- **Web search/fetch:** visible **Cursor web search** / **Cursor web fetch** activity when the SDK reports completed replayable tool data. These cards are display-only; OMP does not expose executable web search/fetch tools through replay.
- **Unknown/future SDK tools:** neutral Cursor activity cards titled with the SDK tool name and bounded scrubbed args/result/error text until an explicit spec is added.

Native replay is display-only:

- OMP does not re-run Cursor-side commands.
- OMP does not apply Cursor-side edits or deletes.
- OMP does not call Cursor-side MCP servers.
- replay-only cards do not update OMP state or generate images.
- replay does not expose OMP tool schemas to Cursor; the local OMP MCP bridge is the separate path that exposes active OMP tools.
- replay does not add OMP web search, web fetch, or browser tools; **Cursor web search** / **Cursor web fetch** cards only mirror SDK-reported Cursor web activity.
- Cursor workflow tools such as `SwitchMode` and Cursor todo state are not OMP workflow controls; reported todo/plan events are displayed as Cursor activity only. Plan/todo replay cards do not drive OMP plan-mode state.

Other unsupported Cursor SDK tools may still be described through a bounded scrubbed activity transcript when the SDK reports completed tool-call data. Started Cursor SDK tool calls that never receive a completion event are surfaced as neutral **Cursor … did not complete** activity cards or equivalent low-noise thinking traces with a bounded reason such as `missing completion`, `aborted`, or `SDK run failed` when the run failed/aborted, produced no assistant text, or involved external/side-effectful tools. Incomplete fast local discovery starts (`read`, `grep`, `glob`, `ls`) are recorded for maintainer debug but suppressed from user-visible output after a successful text-producing run, because those are often stale SDK start events that would otherwise create confusing red post-answer cards such as **Cursor find did not complete**. They are not replayed as successful results and raw args/results/errors are not dumped. Explicit failures remain visible when Cursor reports an error through a completed tool call or step result. Some Cursor-internal workflow actions (including web search/fetch that never surfaces as replayable SDK tool completions or local transcript web tool records) may only appear in Cursor's own thinking stream, assistant text, or not be reported as replayable SDK tool data at all.

## SDK reporting limits

These are integration boundaries, not OMP replay bugs:

- **Live web-search ordering:** local Cursor WebSearch can be absent from live `onDelta`, `onStep`, and `run.stream()` tool events. When the only evidence is a post-run local transcript `webSearchToolCall`, OMP can display the **Cursor web search** card only after `run.wait()` finishes. The extension intentionally keeps assistant text streaming instead of buffering the whole answer just to reorder that card.
- **WebFetch availability:** `omp-cursor` can display a Cursor web fetch only after the SDK reports a `webFetchToolCall`, web-fetch-shaped MCP completion, or web-fetch host alias. It cannot make the Cursor SDK expose or execute WebFetch in a run where Cursor's tool set does not include it.

- **Process-level transport exceptions:** Connect/network suppression remains scoped to active provider turns; raw Cursor SDK `AbortError` DOMExceptions are suppressed while any provider turn or session process-error guard is active. The exact SDK-provenance `WriteIterableClosedError` remains guarded for the OMP session lifecycle.

### Cursor subagent visibility limits

Cursor SDK `task` activity is surfaced as **Cursor subagent** because it represents Cursor-spawned child-agent work. The card can show the subagent start, final result text, subagent kind/model/short-ID metadata, and compact `conversationSteps` tool-call summaries when the SDK includes them. It is not a native OMP subagent session and does not guarantee a live nested action stream. If Cursor only returns final subagent text and no nested tool calls, OMP cannot show the subagent's internal activity.

Most Cursor tool visibility is completion-based: the completed replay card (or bounded transcript trace) is the source of truth for recorded results. For long-running or externally meaningful tools, the provider may also surface one low-noise in-progress line while Cursor is still waiting on the tool.

Lifecycle rules:

- Eligible tools include `task` (shown as **Cursor subagent** by default), `shell`, `mcp`, `generateImage`, `recordScreen`, `semSearch`, web search/fetch activity, and plan/todo activity. Fast local tools such as `read`, `grep`, and `glob` do not get lifecycle lines in normal cases.
- A short defer window coalesces fast start+complete pairs: if a tool completes before the defer elapses, only the completed replay card/trace is shown.
- Lifecycle text is emitted as a single bounded, scrubbed thinking line such as `Cursor MCP: external_search` or `Cursor shell: npm test`. Shell pending labels show a scrubbed/truncated command preview, matching OMP's native bash UX; the completed replay card remains the source of truth for recorded shell results. Lifecycle lines are not separate permanent replay cards and do not rerun tools.
- Implementation: `src/cursor-tool-lifecycle.ts` (eligibility/labels) and `src/cursor-provider-turn-coordinator.ts` (defer, emit, bridge exclusion).
- OMP bridge MCP calls (`pi__*`) are excluded because OMP already shows the real OMP tool execution path.

## Ordering and non-interactive output


As Cursor SDK tool completions arrive, the extension mirrors native OMP ordering by ending a tool-use turn, letting OMP render the recorded tool results, then continuing with live post-tool Cursor thinking/text, later Cursor tool batches, or Cursor's final answer as the next assistant turn. For plan-mode runs, neutral Cursor plan/todo cards can therefore appear before the final Cursor plan text.

Bridged OMP tool calls follow the same visible OMP `toolUse` turn shape, but they are real OMP tool executions rather than replayed Cursor results. Local usage accounting uses per-turn raw Cursor SDK `turn-ended.usage` when available before the corresponding OMP turn is emitted, including cache read/write fields.


JSON and RPC consumers receive structured replay for completed Cursor host tools when replay wrappers are active: host activity is emitted as OMP `toolcall_*` / `tool_execution_*` events backed by recorded Cursor results, not by re-running the host tool. Ordinary print-mode main sessions stay text-first so `omp -p` keeps printing normal assistant text. OMP Agent Hub children using the shipped `cursor` agent are the deliberate exception: although their worker sessions are headless print-mode sessions, existing replay wrappers are enabled for their persisted transcript and Activity surfaces. When replay wrappers are inactive, such as with `--no-tools` or an explicit opt-out, non-interactive consumers fall back to bounded scrubbed transcript data in thinking blocks.

Cursor native replay has one neutral replay tool name, `cursor`, plus native-compatible card names when renderer-compatible: `read`, `bash`, `grep`, `find`, `ls`, `edit`, and `write`. Neutral replay identity lives in `activityTitle`, `activitySummary`, and typed replay details, not in extra registered tool names.


Bridge MCP names are also not OMP tool names. Cursor may see names such as `pi__sem_reindex` inside the local MCP bridge, but OMP session output uses the real OMP tool name.


Native replay wrappers are registered only for tool names not already owned by another extension. If another extension already owns a wrapper name needed for replay, omp-cursor skips only the conflicting wrapper and uses the scrubbed Cursor activity transcript for that tool instead.

```bash
PI_CURSOR_NATIVE_TOOL_DISPLAY=0 omp --model cursor-sdk/grok-4.6
```
`PI_CURSOR_REGISTER_NATIVE_TOOLS=0` is also accepted as a registration-only opt-out.
