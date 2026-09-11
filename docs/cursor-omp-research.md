# OMP 集成 Cursor 的深度调研结果

> 调研目的：为 Oh My Pi（OMP）接入 Cursor，找到不依赖 Cursor 私有协议、可通过 HTTP proxy、支持模型选择、MCP、Skills、实时进度/工具/思考、OMP 子代理和中途 steer 的可行方案。
>
> 调研结论：优先使用 Cursor 官方 Agent SDK 的 `local` runtime，再用 OMP extension 和原生 `task` 包装；不要继续使用当前 OMP 内置 Cursor subscription provider，也不要把 Cursor CLI/订阅封装成 OpenAI-compatible proxy。

## 0. 调研范围、证据等级和当前状态

### 0.1 证据等级

- **官方文档/官方源码**：Cursor SDK、CLI、ACP、Cloud Agents、OMP 官方源码和文档。
- **官方员工论坛回答**：不是合同文本，但直接回答了外部 harness 和代理的政策风险。
- **社区仓库**：用于评估可复用实现，不代表 Cursor 或 OMP 官方背书。
- **[推断]**：由 OMP 的公开 extension/task API 与 Cursor SDK 能力组合出的架构，需要在目标版本做 smoke test。

### 0.2 版本和环境注意事项

本轮目标环境和已安装基线：

- OMP 本机版本为 `18.1.13`，使用 Bun。
- Bun 版本为 `1.4.2`，Node 版本为 `22.22.2`。
- 已安装 `LoneExile/omp-cursor-sdk` 的 `omp-port` 分支，package version 为 `0.3.3`。
- 该插件依赖 `@cursor/sdk@1.0.23` 和 `@oh-my-pi/*@17.3.0`，与当前 OMP 18 存在版本差距。
- `fitchmultz/pi-cursor-sdk` 当前主干 package version 为 `0.3.6`，依赖 `@cursor/sdk@1.0.27`，是新的代码基线候选。

这些版本随时间变化。`LoneExile/omp-cursor-sdk` 不能直接视为当前 OMP 的 drop-in plugin，新的实现应直接 fork Pi 主干，再按目标 OMP 版本适配。

本地工作区已执行 `git init`，当前分支为 `omp-port`。直接 fork 版 provider、OMP native task agent 和 bridge 默认关闭策略已实现；没有提交或推送。

### 0.3 当前验证快照

- 插件 build、typecheck、package contract 和完整 Vitest 已通过；最新上下文/终结器回归为 46 tests passed。
- `agents/cursor.md` 已进入 npm package，并以 `model: cursor-sdk/default` 注册可由 OMP 原生 task discovery 发现的 `cursor` agent。
- OMP 原生 child session、Agent Hub、生命周期、外层 steer/cancel 仍由 OMP task 提供；Cursor SDK 内部 subagent 不映射为独立 OMP Hub 节点。
- `cursor-sdk` provider 已承载 Cursor SDK 的 assistant、thinking、tool、status、usage 事件；OMP bridge 仍默认关闭。
- 已通过真实 OMP 18 `task(agent="cursor")` smoke：父会话成功派发 native task，子任务解析为 `cursor-sdk/default`，子会话通过 hidden `yield` 完成并以 `completed` 返回 `OMP_TASK_SMOKE_OK`；父会话返回 `OMP_PARENT_TASK_SMOKE_OK`。
- 本次 smoke 使用的 Cursor API key 只通过临时进程环境注入，没有写入仓库、OMP 配置或 auth DB；验证后应立即在 Cursor 侧撤销/删除该 key。

## 1. 需求拆解

目标需要同时满足：

1. 避开 OMP 当前 Cursor subscription provider 的私有协议和账号风险。
2. 比当前方案更快或至少降低首轮/重复 turn 的开销。
3. 所有 Cursor 出站流量通过 HTTP proxy，适合内网。
4. 在 OMP 对话中把任务交给 Cursor。
5. 让 Cursor 作为 OMP 的子代理出现。
6. 指定 Cursor 具体模型、fast/reasoning 等参数。
7. Cursor 继续使用自己的动态 prompt、MCP、Skills、Rules 和 coding-agent 工具。
8. OMP 显示 Cursor 的进度、工具调用、thinking、assistant 输出、usage。
9. Cursor 像 IDE 一样持续构建 prompt 和执行多步任务，而不是每轮重新启动。
10. OMP 可以在 run 中途 steer、cancel 或追加指令。
11. 必要时允许通过 OMP plugin 自己实现适配层。
12. OMP tools、MCP、Skills 默认不暴露给 Cursor，按配置开关按类别启用。
13. bridge 关闭时不注入 OMP tool catalog、MCP catalog、Skills catalog、skill path 或 bridge guidance，避免与 Cursor IDE 的原生能力冲突。

## 2. 账号、协议和合规边界

### 2.1 当前 OMP provider 的性质

OMP 当前 Cursor provider 源码显示，它不是普通的公开模型 API：

- 使用 `api2.cursor.sh`；
- 直接调用内部 agent transport，例如 `/agent.v1.AgentService/Run`；
- 使用内部客户端标记，例如 `x-ghost-mode`；
- OAuth 代码包含 Cursor session token exchange；
- 实质上是对 Cursor 客户端/agent 请求的复刻或私有适配。

相关源码：

- [OMP Cursor provider](https://github.com/can1357/oh-my-pi/blob/main/packages/ai/src/providers/cursor.ts)
- [OMP Cursor OAuth](https://github.com/can1357/oh-my-pi/blob/main/packages/ai/src/registry/oauth/cursor.ts)
- [OMP providers 文档](https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/providers.md)

### 2.2 Cursor 官方员工的明确回答

Cursor 官方论坛员工明确回答：

- 用自己的 proxy 把 Cursor subscription models（例如 Composer）提供给其他 harness，不允许；
- 这种 proxy 通常调用 private/non-public client endpoints；
- 可能触发 abuse enforcement 或账号封禁；
- 官方外部自动化方式是 Cursor CLI 和 Agent SDK；
- CLI/SDK 运行完整 Cursor agent harness，而不是提供裸模型；
- 当前没有可供 Codex 等外部 harness 直接使用的 OpenAI-compatible `/v1/chat/completions` endpoint。

来源：[官方论坛员工回答](https://forum.cursor.com/t/using-cursor-frontier-models-like-composer-2-5-in-external-harnesses-e-g-codex/164676/5)

### 2.3 Terms/AUP 的限制与矛盾

Cursor Terms 对 reverse engineering、访问 service underlying structure、reproduce/modify、scrape/harvest/extract 等有广泛限制；AUP 对 automated/non-human use、bypass 和 usage manipulation 也有宽泛表述。

- [Cursor Terms of Service](https://cursor.com/en-US/terms-of-service)
- [Cursor Acceptable Use Policy](https://cursor.com/en-US/acceptable-use-policy)

这里存在一个必须显式保留的矛盾：

- 官方文档和员工回答把 CLI/SDK 定为官方 external agent 路径；
- 通用 Terms/AUP 的自动化限制文字很宽；
- 因此不能声称“使用 SDK 绝对不会封号”。

高价值账号或企业环境的最稳妥做法是：使用 API key/service account key，并向 Cursor support/Enterprise 获取针对目标外部 harness 的书面确认。

### 2.4 明确不能做的事

- 不要复用 `CURSOR_ACCESS_TOKEN`；
- 不要从 Cursor IDE 的 auth 文件提取 token；
- 不要把个人订阅登录态转换成自有 API；
- 不要使用账号轮换；
- 不要构造 Cursor subscription 的 OpenAI-compatible proxy；
- 不要仅替换 endpoint，却继续复刻私有协议；
- 不要把私有 token 放进 OMP plugin、日志、仓库或 issue。

### 2.5 官方 SDK 的认证含义

官方 SDK 使用：

- Cursor user API key；或
- Teams/Enterprise service account API key。

SDK usage 走 Cursor 正常计费、request pool 和 Privacy Mode，并在 usage dashboard 标记为 SDK。SDK 不是将现有 IDE session token 合法化的工具。

来源：[Cursor TypeScript SDK authentication/billing](https://cursor.com/docs/sdk/typescript)

## 3. 官方实现选项

## 3.1 Cursor Agent SDK：首选

官方 TypeScript 包为 `@cursor/sdk`，Python 包为 `cursor-sdk`。SDK 暴露的就是与 Cursor IDE/CLI/web 相同的 agent runtime。

- [TypeScript SDK](https://cursor.com/docs/sdk/typescript)
- [Python SDK](https://cursor.com/docs/sdk/python)
- [SDK Bridge](https://cursor.com/docs/sdk/bridge)
- [Cursor Cookbook](https://github.com/cursor/cookbook)

### Local 与 Cloud

| runtime | 行为 | 适用场景 |
|---|---|---|
| `local` | agent loop 在本地进程执行，文件来自本地 `cwd` | OMP 当前工作树、开发脚本、CI |
| `cloud` | Cursor VM 中执行，仓库被 clone 到云端 | issue→PR、断线后继续、多 agent 并行 |

SDK 文档特别强调：`local` 只表示 agent loop 和 filesystem 在本地，模型推理仍然走 Cursor hosted models，不是离线模型。

### Agent/Run 生命周期

- `Agent` 是持久容器，持有 conversation、workspace config 和 settings；
- `Run` 是一次 prompt，拥有 stream、status、result、cancel；
- 可以复用 Agent，而不是每轮重新启动；
- 可使用 `Agent.resume` 恢复；
- `Agent.reload` 可重新加载 filesystem hooks、MCP 和 subagents；
- `run.wait`、`run.conversation`、usage/status API 可用于外层状态管理。

这正好支持“像 Cursor IDE 一样持续工作”。

### 模型选择

通过 `Cursor.models.list()` 获取当前账号/team 可用的真实模型 catalog。模型 ID、fast variant、reasoning/effort 参数可能因账号而不同。

测试 smoke 固定使用 `default`，不使用 `auto`，也不默认固定到具体 Composer 或其他模型。

```ts
const models = await Cursor.models.list();

const agent = await Agent.create({
  apiKey: process.env.CURSOR_API_KEY!,
  model: {
    id: "default",
  },
  local: {
    cwd: process.cwd(),
  },
});
```

不要把某个固定 alias 当成永远稳定的模型 ID。OMP 插件应将 SDK catalog 转成 OMP dynamic models，并把模型的 params 原样传递给 `Agent.create`。

Cursor Router 在 SDK 中是 `auto-smart` 加 `optimize_for` 参数，而不是裸 model inference endpoint。

### 实时事件

SDK normalized stream 可以提供：

- `system`
- `user`
- `assistant`
- `thinking`
- `tool_call`
- `status`
- `task`
- `request`
- `usage`
- text/thinking/tool/shell-output delta

因此 SDK 是满足 OMP 显示 thinking、tool call、progress 和 output 的最佳官方接口。

### Steering 与取消

Local Run 支持：

- `run.steer(text)`：将新指令注入当前执行中的 run；
- `run.cancel()`：取消当前 run；
- `Agent.resume(...)`：恢复持久 agent。

Cloud run 的 steer 会退化为 follow-up，而不是同一 local turn 中的即时 steer。

### MCP、Skills、Rules

SDK 可通过 `mcpServers` 配置 MCP，也可以从 Cursor 配置文件读取。`settingSources` 可以控制：

- `project`
- `user`
- `plugins`
- `all`

Cursor 原生读取的相关位置包括：

- `.cursor/mcp.json`
- `~/.cursor/mcp.json`
- `.cursor/skills/**/SKILL.md`
- `.agents/skills/**/SKILL.md`
- `~/.cursor/skills`
- `~/.agents/skills`
- `.cursor/rules`
- `AGENTS.md`
- `CLAUDE.md`

生产环境建议从 `project` 和经过审查的 `plugins` 开始；只有确实需要完全复刻 Cursor IDE 时才使用 `all`。

### system prompt

SDK 支持自定义 `systemPrompt`，但官方文档警告：替换 Cursor built-in system prompt 会失去 coding-agent identity 和工具指导。

推荐只传：

- 用户任务；
- 必要的 OMP context；
- 少量安全约束。

不要把 OMP 的完整 system prompt 手工拼成 Cursor prompt。

### SDK 安全默认值

Headless local agent 没有 IDE 的人工批准 UI，quickstart 默认可能直接执行 shell/edit/write。应由 OMP plugin 明确设置：

- sandbox；
- pre-tool hooks；
- shell/write/network allowlist；
- MCP 权限；
- 任务超时和取消。

## 3.2 Cursor CLI headless

Cursor CLI 当前文档使用 `agent` 命令，旧文档或旧安装可能使用 `cursor-agent`。安装后应检查实际 binary 和版本。

CLI 支持：

- Agent/Plan/Ask modes；
- MCP；
- ACP；
- Rules；
- `--model`；
- `--resume` / `--continue`；
- `--workspace` / `--worktree`；
- headless `-p/--print`；
- `--output-format text|json|stream-json`；
- `--stream-partial-output`；
- `--force` 写入文件。

来源：

- [CLI using](https://cursor.com/docs/cli/using)
- [CLI headless](https://cursor.com/docs/cli/headless)
- [CLI parameters](https://cursor.com/docs/cli/reference/parameters)
- [CLI authentication](https://cursor.com/docs/cli/reference/authentication)
- [CLI output format](https://cursor.com/docs/cli/reference/output-format)

### CLI 的限制

`stream-json` 可输出 system/user/assistant/tool_call/result 等 NDJSON，但官方文档明确：

> print mode 会抑制 thinking events，因此 `--print` 模式不能完整满足显示 Cursor thinking。

CLI 也没有通用的双向 in-flight steer API。通常只能 cancel、resume 或下一轮追加 prompt。

因此 CLI 适合 ACP 不可用时的备用路径，不适合作为当前全部需求的首选。

## 3.3 ACP

启动：

```bash
agent acp
```

transport 是 stdio，消息是 JSON-RPC 2.0 newline-delimited JSON。

典型流程：

1. `initialize`
2. `authenticate`，method id 为 `cursor_login`
3. `session/new` 或 `session/load`
4. `session/prompt`
5. 接收 `session/update`
6. 处理 `session/request_permission`
7. 需要时 `session/cancel`

ACP 能显示：

- message chunks；
- thought chunks；
- tool calls；
- plans；
- usage；
- commands；
- permission requests。

Cursor 还定义了扩展方法：

- `cursor/ask_question`
- `cursor/create_plan`
- `cursor/update_todos`
- `cursor/task`
- `cursor/generate_image`

ACP 的关键不足是没有通用的 in-flight steer 方法。可以 cancel 后继续对同一 session prompt，但这不等同于 SDK local 的 `run.steer`。

MCP 读取 project/user `.cursor/mcp.json`，但 Cursor CLI ACP 文档指出 team-level MCP 在 ACP 中不支持。

来源：

- [Cursor ACP](https://cursor.com/docs/cli/acp)
- [Agent Client Protocol overview](https://agentclientprotocol.com/protocol/overview)
- [ACP prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn)
- [ACP tool calls](https://agentclientprotocol.com/protocol/v1/tool-calls)
- [ACP content](https://agentclientprotocol.com/protocol/v1/content)
- [ACP plans](https://agentclientprotocol.com/protocol/v1/agent-plan)

## 3.4 Cloud Agents API/SDK

官方 Cloud Agents API 支持：

- durable agent；
- repository；
- explicit model；
- `autoCreatePR`；
- MCP servers；
- custom subagents；
- modes；
- environment variables；
- SSE stream；
- assistant/thinking/tool_call/interaction_update/heartbeat/result/done；
- Last-Event-ID 恢复；
- cancel。

来源：[Cloud Agents API endpoints](https://cursor.com/docs/cloud-agent/api/endpoints)

适合：

- issue→branch→PR；
- 后台长任务；
- 多 repo 并行；
- 调用方断线后继续。

不适合当前 OMP 对话的同目录交互：工作区在 Cursor VM，local OMP bridge 不可直接复用，live steer 通常退化为 follow-up。

## 3.5 SDK Bridge

官方 [cursor/sdk-bridge](https://github.com/cursor/sdk-bridge) 提供低层 bridge：

- `sdk.v1` proto；
- Connect/protobuf HTTP/1.1 loopback；
- Create/Resume/Send streaming；
- ObserveRun/WaitLiveRun/GetRun/CancelRun；
- durable stream envelope、keepalive 和 offset recovery。

如果 OMP plugin 只是同一 Node/Bun 进程里的适配，优先用 TypeScript SDK。只有需要隔离 SDK 进程、跨语言或规避 runtime 兼容问题时才考虑 bridge。

## 4. OMP 可用的集成面

### 4.1 OMP 原生 `task`

OMP `task` 支持：

- 自定义 agent type；
- agent frontmatter；
- model role；
- background task；
- live progress；
- Agent Hub；
- hub follow-up/steer；
- isolated worktree；
- batch/context；
- task lifecycle 和 artifacts。

来源：[OMP task 文档](https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/tools/task.md)

OMP 的 agent model precedence 大致为：

```text
task.agentModelOverrides
→ agent frontmatter model
→ configured model role / parent fallback
```

### 4.2 OMP extension

公开 extension API 包括：

- `registerProvider`
- `registerTool`
- `registerCommand`
- `registerMessageRenderer`
- `registerAssistantThinkingRenderer`
- tool renderers
- `sendMessage`
- `sendUserMessage`
- `appendEntry`
- `setModel`
- `ctx.ui`
- `ctx.abort`
- events：`tool_call`、`tool_result`、`message_update` 等。

Extension 与 OMP 同进程运行，不是 sandbox。定时器和异步回调必须使用 `ctx.setTimeout`/`ctx.setInterval`，避免异常打穿整个 session。

来源：

- [OMP extensions](https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/extensions.md)
- [OMP extension loading](https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/extension-loading.md)

OMP 18 的公开 SDK 已导出 `AgentRegistry`、`createAgentSession` 和 `AgentSession`，但没有把 `TaskTool` executor 作为 extension 的独立 programmatic API。这个 fork 不复制私有 executor；它通过打包的 `agents/cursor.md` 注册 `cursor` task agent，让 OMP 原生 task 产生 Agent Hub row，Cursor provider 继续承载 SDK run。

### 4.3 OMP Agent Hub

OMP Agent Hub 能显示 running/idle/parked agent，查看模型、token/cost、tool calls、transcript，并对 agent steer、revive、kill。

来源：[OMP Agent Hub](https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/agent-hub.md)

### 4.4 OMP 代理

OMP 出站代理优先级：

```text
PI_PROXY_<PROVIDER>
→ PI_PROXY
→ HTTPS_PROXY / HTTP_PROXY
→ ALL_PROXY
```

`PI_PROXY_CURSOR` 主要作用于 OMP provider fetch wrapper，不应假设它会自动配置 Cursor SDK 内部 HTTP transport。

当前扩展会把上述优先级解析结果应用到 Cursor SDK 的 Node transport。Cursor SDK 没有 per-agent proxy hook，因此这里使用 Node 的 process-global proxy；它影响整个 OMP 进程，而不是只影响单个 provider turn。子 session shutdown 不再恢复该全局设置，避免销毁父任务仍在使用的 transport；测试或显式进程级 teardown 仍可恢复。Loopback 地址会强制加入 `NO_PROXY`，避免 OMP bridge/MCP 本地回环请求经过企业代理。非法 proxy 或运行时不支持 `http.setGlobalProxyFromEnv()` 时，provider 保持可加载并在 `session_start` 给出 warning。

来源：[OMP environment variables](https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/environment-variables.md)

## 5. GitHub 项目评估

GitHub stars、版本和 README 会变化，以下数字仅是本次访问时观察值。

| 项目 | 类型 | 观察到的规模/版本 | 价值 | 结论 |
|---|---|---|---|---|
| [LoneExile/omp-cursor-sdk](https://github.com/LoneExile/omp-cursor-sdk) | OMP/Pi extension | 约 3 stars；plugin `0.3.3`；SDK `1.0.23`；OMP `17.3.0` | 最直接覆盖 OMP provider、model discovery、local pooling、MCP、thinking、replay、OMP tool bridge、steering | 首选基础，建议 fork/update，不要盲装 |
| [fitchmultz/pi-cursor-sdk](https://github.com/fitchmultz/pi-cursor-sdk) | Pi extension | 约 319 stars；SDK 约 `1.0.27` | 更成熟的 stream coordinator、agent pool、MCP、model/mode、thinking、replay | 作为实现参考，不是 OMP drop-in |
| [raphaelluethy/cursor-acp](https://github.com/raphaelluethy/cursor-acp) | 社区 ACP client | 约 6 stars | session persistence、permission、model/mode、MCP、thinking、replay | ACP fallback/reference |
| [cursor/sdk-bridge](https://github.com/cursor/sdk-bridge) | Cursor 官方 bridge | 官方 | 进程隔离、跨语言、durable stream、protocol adapter | 特殊 runtime 场景才需要 |
| [agentclientprotocol/typescript-sdk](https://github.com/agentclientprotocol/typescript-sdk) | ACP 官方 TS SDK | 约 247 stars | 减少 JSON-RPC/ACP client 实现成本 | 只解决协议，不解决 steer 语义 |
| [tageecc/cursor-agent-api-proxy](https://github.com/tageecc/cursor-agent-api-proxy) | CLI/OpenAI proxy | 约 59 stars | 可研究 CLI stream-json 转换 | 不适合主方案，风险和语义损失明显 |
| [anyrobert/cursor-api-proxy](https://github.com/anyrobert/cursor-api-proxy) | CLI/OpenAI proxy | 约 239 stars | OpenAI-compatible facade、可研究 ACP passthrough | 不推荐，不能当官方 raw API |
| [cursor-delegate-mcp](https://github.com/andreilungeanu/cursor-delegate-mcp) | MCP delegation | 约 4 stars | session/follow-up 概念参考 | wrapper，不是 OMP 原生子代理 |
| [cursor-mcp-bridge](https://github.com/JaimeJunr/cursor-mcp-bridge) | MCP bridge | 约 2 stars | delegation/explore/build/follow-up 概念 | 不解决完整 Cursor/OMP lifecycle |
| [cursor-cli-mcp](https://github.com/devshah7/cursor-cli-mcp) | CLI MCP server | 约 2 stars | session create/resume/list models 概念 | 依赖 CLI 行为，缺少完整 live trail |
| [orchestrate-cursor-agent-mcp](https://github.com/thsunkid/orchestrate-cursor-agent-mcp) | 外部编排/MCP | 约 2 stars | 文件 IPC、bidirectional report/reply 概念 | 不推荐作为生产集成 |

### 5.1 `pi-cursor-sdk` 主干与现有 OMP port

`fitchmultz/pi-cursor-sdk` 主干已经覆盖很多复杂的 Cursor 侧能力：

- provider 注册和 Cursor model catalog；
- local SDK agent；
- agent pooling/resume；
- Cursor native thinking/fast/plan；
- Cursor MCP；
- native tool replay；
- 可选的 Pi/OMP tool bridge；
- OMP/Pi skill bridge；
- `run.steer` live path；
- 自定义 renderers；
- local/cloud runtime；
- proxy/http1 配置。

现有 `LoneExile/omp-cursor-sdk#omp-port` 已经提供 OMP 适配参考，但版本较旧：

- package version 为 `0.3.3`；
- `@cursor/sdk` 为 `1.0.23`；
- OMP 依赖为 `17.3.0`；
- provider 名称仍为 `cursor`，可能与 OMP 内置 provider 冲突；
- 当前 OMP 18 实际 turn smoke 返回 `ERROR_NOT_LOGGED_IN`。

因此，新实现应直接 fork `fitchmultz/pi-cursor-sdk`，从最新主干重新建立 OMP port。现有 OMP port 只用于提取已经验证过的适配点和测试经验，不作为 Git 上游或依赖。

新 port 还必须把 OMP tools、MCP、Skills bridge 改为默认关闭。关闭时不能只禁用调用，还必须删除 OMP catalog、skill path 和 prompt guidance。Cursor native tools、MCP、Skills、Rules 默认保持开启。

## 6. 需求矩阵

| 能力 | 当前 OMP Cursor provider | SDK local + OMP plugin/task | CLI/ACP | Cloud SDK/API | OpenAI/MCP proxy |
|---|---|---|---|---|---|
| 使用官方公开路径 | 否/不清晰 | 是，但需 API key/service key | 是 | 是 | 否/不确定 |
| 复用当前本地工作树 | 有但走私有 provider | 有 | 有 | 否，默认云端 VM | 视 wrapper |
| 指定真实 Cursor 模型 | 有限/私有 catalog | 有，`Cursor.models.list()` | 有，`--model` | 有 | facade 自己解释 |
| Cursor MCP | 不完整/依赖 provider | 有 | 有 | 有 | 视 wrapper |
| Cursor Skills/Rules | 不完整/依赖 provider | 有 | 有 | 部分 | 通常不完整 |
| thinking stream | 不保证 | SDK event 有 | print mode 会抑制 | SSE 有 | 常丢失 |
| tool/progress stream | 不保证 | 有 | ACP 有，print 受限 | 有 | 常丢失 |
| 中途 steer | 不明确 | local `run.steer` | 主要 cancel/follow-up | follow-up | 不可靠 |
| OMP Agent Hub | 有限 | 外层原生 task 后有 | 需自己包装 | 只能作为 job | 无 |
| HTTP proxy | OMP wrapper 相关 | 标准 env + SDK config | 官方支持 | 调用端可代理，云端出站另算 | 有额外 hop |
| 账号风险 | 高 | 最低可行风险 | 低 | 低 | 高/不明确 |

## 7. 推荐架构

### 7.1 主路线

```text
OMP 主会话
  │
  └─ native task(agent="cursor")
       │
       └─ OMP child session / Agent Hub row
            │
            └─ cursor-sdk provider adapter
                 │
                 └─ @cursor/sdk local Agent
                      ├─ Cursor dynamic system prompt
                      ├─ Cursor model
                      ├─ Cursor native tools
                      ├─ Cursor MCP
                      ├─ Cursor Skills/Rules
                      └─ optional OMP loopback MCP bridge
                           ├─ OMP tools
                           ├─ OMP MCP
                           └─ OMP Skills
```

核心设计：

1. 直接 fork `fitchmultz/pi-cursor-sdk`，使用 `LoneExile/omp-cursor-sdk` 作为适配参考。
2. Extension 注册独立的 `cursor-sdk` provider，不能覆盖或回退到 OMP 内置 `cursor` provider。
3. 通过 `Cursor.models.list()` 做 dynamic model discovery/cache。
4. 每个 OMP child/session 建立一个有明确 key 的 Cursor SDK Agent：`cwd + model + settings + auth identity + bridge surface`。
5. 一个 OMP turn 对应一个 Cursor SDK Run，兼容的后续 turn 复用同一个 Agent。
6. 默认不传自定义 `systemPrompt`，让 Cursor 保留自己的 prompt、Rules、Skills、MCP 和 tool instructions。
7. 把 OMP 当前任务作为 user message 或最小 bootstrap context，不重复发送完整 OMP system prompt。
8. 把 SDK event 映射到 OMP assistant stream、thinking renderer、tool renderer、status 和 replay。
9. 把 OMP child 的 abort/Hub cancel 映射到 `run.cancel()`，把 Hub steer 映射到 local `run.steer()`。
10. 通过可选 loopback MCP bridge 暴露 OMP tools、MCP、Skills；bridge 默认关闭，关闭时不得注入对应 catalog、路径和 guidance。
11. OMP bridge 与 Cursor native tools 使用独立命名空间，默认隐藏重复 builtin tools，避免 Cursor IDE 和 OMP 的能力冲突。
12. Cursor 内部 subagent 仍属于 Cursor SDK，不承诺自动成为 OMP Agent Hub 的独立节点。

### 7.2 OMP agent 配置示意

具体 provider/model syntax 需要以目标插件为准。以下是结构示意：

```yaml
# ~/.omp/agent/config.yml
modelRoles:
  cursor_worker: cursor-sdk/default
```

```json
{
  "ompBridge": {
    "enabled": false
  }
}
```

```md
<!-- ~/.omp/agent/agents/cursor.md -->
---
name: cursor
description: Run the full Cursor coding agent in the current workspace.
model: "@cursor_worker"
---

Work continuously on the assigned task as a Cursor coding agent.
Use Cursor native rules, skills, MCP servers, and tools. Use OMP tools, MCP, or skills only when the OMP bridge is explicitly enabled.
Do not stop after a plan unless the user asks for a plan only.
```


`@fast:high` 只是示意。具体 fast variant、thinking level 和 model ID 由 SDK catalog 与插件适配器决定。

### 7.3 事件映射建议

| SDK 事件 | OMP 行为 |
|---|---|
| `text-delta` | assistant 增量输出 |
| `thinking-delta` | `registerAssistantThinkingRenderer` |
| `tool_call` started | 工具调用卡片、名称和参数摘要 |
| `tool_call` completed | 工具结果卡片、耗时和错误 |
| shell output | 可折叠输出 |
| `status` | Agent Hub 状态/运行阶段 |
| `task` | 子任务进度 |
| `usage` | token、cost、运行统计 |
| `request` | OMP UI 询问、权限请求或拒绝策略 |
| `run.steer()` | OMP Hub steer |
| `run.cancel()` | OMP abort/kill |

参数和结果的 event shape 可能升级，解析器应对未知 type 做中性 fallback，不要因一个新字段让整个 session 崩溃。

### 7.4 Native task 与 Cursor 内部 agent 的边界

当前实现通过打包的 `agents/cursor.md` 注册 OMP task agent `cursor`，frontmatter 将 child model 路由到 `cursor-sdk/default`。因此 `task(agent="cursor")` 使用 OMP 原生 child session、AgentRegistry、Agent Hub 和生命周期；Cursor SDK provider 在这个 child session 内承载自己的 agent loop。

所以：

- OMP Hub 控制外层 Cursor worker；
- Cursor native tool 的真实执行发生在 SDK 内部；
- 工具可以被 OMP 显示，但默认不是 OMP 自己再次执行的 tool call；
- Cursor nested subagent 的完整 live trail 不应作为硬性保证；
- 如果要让 Cursor 调用 OMP 工具，需要显式 MCP/custom tool bridge。

### 7.5 不要错误地把 SDK 当作 raw provider

Cursor SDK 是完整 agent runtime，不是 OpenAI chat-completions API。简单把 SDK 套入 OMP 的普通 raw `streamSimple` 而没有 coordinator，容易造成：

- double agent loop；
- OMP system prompt 与 Cursor system prompt 冲突；
- tool call 已在 SDK 内执行，OMP 又误以为需要执行；
- steer 只能进入 OMP 队列，进不了 Cursor run；
- replay 与真实执行状态不一致。

应单独维护 Cursor turn coordinator。

## 8. MCP、Skills 和 OMP bridge

### 8.1 推荐优先级

1. Cursor 自己的 `.cursor/mcp.json`；
2. SDK `mcpServers` inline config；
3. Cursor Skills/Rules 原生目录；
4. 只有需要调用 OMP 专有工具时，才增加 `pi__*` MCP/custom tool bridge。

OMP `.omp/skills` 不会自动被 Cursor SDK 识别。可选方法：

- 使用现有插件的 OMP skill bridge，例如 `pi__cursor_activate_skill`；
- 将经过审查的技能镜像到 `.agents/skills`；
- 暴露为 MCP server。

不要把全部 OMP skills 盲目复制进 Cursor，也不要把两套完整 system prompt 拼在一起。

### 8.2 MCP OAuth

SDK/headless 进程可能不能像 Cursor IDE 一样弹 OAuth UI。需要：

- 预先在 Cursor 中完成 OAuth；
- 使用 MCP headers；
- 或使用 service account/machine credential。

## 9. Proxy 和速度优化

### 9.1 官方环境变量

```bash
export HTTP_PROXY=http://proxy.example:8080
export HTTPS_PROXY=http://proxy.example:8080
export NO_PROXY=localhost,127.0.0.1
export NODE_USE_ENV_PROXY=1
```

公司 proxy 做 TLS MITM 时：

```bash
export NODE_EXTRA_CA_CERTS=/absolute/path/corporate-ca.pem
```

来源：[Cursor CLI configuration](https://cursor.com/docs/cli/reference/configuration)

SDK 所在 OMP 进程必须继承这些环境变量。不要把 proxy 用户名/密码写进仓库、命令行历史或日志。

### 9.2 HTTP/2 与 HTTP/1.1

默认先用 HTTP/2。若企业 proxy 不支持 bidirectional HTTP/2 streaming，再配置：

```json
{
  "version": 1,
  "editor": { "vimMode": false },
  "permissions": { "allow": [], "deny": [] },
  "network": {
    "useHttp1ForAgent": true
  }
}
```

SDK 对应使用 `useHttp1ForAgent` 配置。HTTP/1.1 是兼容性 fallback，不是速度优化；proxy 支持 HTTP/2 时不应主动降级。

### 9.3 速度优化

不应承诺 SDK 一定更快。可做的低风险优化：

1. interactive task 使用 `local`；
2. 复用 long-lived Agent；
3. cache `Cursor.models.list()`，提供 refresh；
4. 预热 workspace；
5. 使用账户允许的 fast variant；
6. 不每轮重建 MCP/Skills；
7. 默认 HTTP/2；
8. OMP 同一工作树的写任务串行；
9. 并行写任务使用 OMP `isolated:true`；
10. 分别测量首个文本 delta、首个 tool call、完整 run 时长和代理延迟。

## 10. 安全与运行策略

### 10.1 认证

推荐：

- user API key（个人用途）；
- service account API key（Teams/Enterprise）；
- secret store 或环境变量；
- 不将 token 写进 session artifact。

不要使用 IDE 登录态或 OMP 私有 Cursor OAuth 路径。

### 10.2 写操作

SDK local headless 没有人工审批 UI，因此 plugin 应提供：

- read-only/plan 模式；
- sandbox；
- shell/write/network allowlist；
- `autoReview` 或 hook；
- explicit confirmation；
- 运行时 timeout、budget 和 cancel。

### 10.3 工作树并发

- 同一工作树上的多个 Cursor agent 会产生文件竞争；
- OMP non-isolated task 适合串行；
- `isolated:true` 需要 git repo，并由 OMP 管理 worktree/patch/branch；
- Cursor SDK 的 `cwd` 必须指向对应 isolated workspace；
- 不应让多个 agent 同时修改同一目录却只依赖最终 diff 合并。

### 10.4 日志

日志可以记录：

- provider/model ID；
- run/agent ID；
- phase/status；
- duration；
- token/usage；
- sanitized tool names。

日志不得记录：

- API keys；
- proxy Authorization；
- MCP secrets；
- Cursor auth files；
- 用户项目中的敏感文件内容。

## 11. 分阶段验证计划

### 阶段一：直接 fork 后的 OMP 18 基础适配

1. 直接 fork `fitchmultz/pi-cursor-sdk`，建立独立 `omp-port` 分支。
2. 锁定 OMP、Bun、Node 和 `@cursor/sdk` 版本。
3. 将 Pi extension/provider API 适配到 OMP 18。
4. 注册独立 `cursor-sdk` provider，禁止内置 `cursor` provider 或私有 transport fallback。
5. `Cursor.models.list()` 返回真实可用 model catalog。
6. `Agent.create({ local: { cwd } })` 成功。
7. OMP 通过 `cursor-sdk` 完成一次实际 prompt。
8. 只使用 Cursor API key，不能通过 `CURSOR_ACCESS_TOKEN` 运行。

### 阶段二：Cursor 原生 Agent 和多轮能力

1. `run.stream()` 能观察到 assistant、thinking、tool_call、status、usage。
2. 不覆盖 Cursor 默认 system prompt。
3. Cursor project/user Rules、Skills 和 MCP 能被正确加载。
4. 连续 OMP turns 复用同一个 Cursor Agent。
5. `run.steer()` 能改变运行中的任务。
6. `run.cancel()` 能终止。
7. `Agent.resume()` 能恢复。
8. native replay 与实时 stream 不重复执行工具。

### 阶段三：OMP bridge 默认关闭和按 surface 开启

1. 默认没有 OMP `omp__*` tool。
2. 默认没有 OMP MCP catalog。
3. 默认没有 OMP Skills catalog、skill path 或 activation guidance。
4. 默认关闭时 Cursor native tools、MCP、Skills、Rules 仍然可用。
5. 只开启 tools 时，只暴露 allowlist 内的 OMP tools。
6. 只开启 MCP 时，只暴露 OMP MCP bridge。
7. 只开启 Skills 时，只暴露 OMP skill catalog 和 activation tool。
8. 重叠的 OMP builtin tools 默认隐藏。
9. bridge tool call 走正常 OMP lifecycle，并返回同一个 Cursor Run。
10. bridge cancel、timeout、session shutdown 不留下 pending call、timer 或 process。

### 阶段四：OMP 原生 task/Hub

1. `task(agent="cursor")` 创建 OMP child。
2. Agent Hub 显示 child、model、状态和 token。
3. thinking、tool call、assistant text 正常渲染。
4. Hub steer 确实调用 `run.steer()`。
5. Hub cancel 确实调用 `run.cancel()`。
6. 任务完成后无 orphan stream/process。
7. isolated task 的 patch/branch 可正确处理。
8. Cursor 内部 nested subagent 的显示边界符合文档，不伪装成 OMP Hub 节点。

### 阶段五：Proxy 和安全验收

1. HTTP/2 通过 proxy。
2. h2 失败时 HTTP/1.1/SSE fallback。
3. 企业 CA 能正确验证 TLS。
4. `NO_PROXY` 不影响本地 MCP/loopback。
5. 代理日志只记录脱敏的目标/时延。
6. 认证、模型发现和 stream 都走期望的网络路径。
7. Headless tool 调用有明确 sandbox、hooks、allowlist、timeout 和 cancel policy。
8. 日志和 session transcript 不包含 API key、access token、cookie、MCP secret 或文件内容。

### 阶段六：真实项目前安全验收

1. 先 plan/read-only；
2. 再允许临时目录写入；
3. 再允许测试项目；
4. 最后才接真实仓库凭据；
5. 完整记录版本、模型、key identity、proxy、MCP allowlist 和回滚方法。

## 12. 主要未决风险和矛盾

### 12.1 SDK 是否一定不会封号

不能保证。官方员工明确将 CLI/SDK 作为官方路径，但 Terms/AUP 对自动化文字很宽。API key/service account + 书面确认是风险最低的处理方式。

### 12.2 SDK 是否一定比当前 provider 快

不能保证。它避免私有复刻和不必要的 proxy 层，但速度仍受 Cursor backend、模型、workspace scan 和企业 proxy 影响。需要基准测试。

### 12.3 OMP 版本兼容性

现有社区插件依赖 OMP 17.x，而当前 OMP 为 18.1.13。必须直接从 `fitchmultz/pi-cursor-sdk` 主干建立新 port，针对 OMP 18 的 provider、session、tool、TUI 和 task API 做适配和 smoke，不能只看 README 或继续修补旧 `node_modules`。

OMP bridge 默认关闭是新的安全约束。验证时必须检查关闭状态下 OMP tool/MCP/Skills 的 catalog、路径和 prompt guidance 均不存在，而不只是检查调用会被拒绝。

### 12.4 Nested Cursor subagent 的完整显示

SDK 能显示主 agent 的事件，但 Cursor 内部 subagent 的实时细节可能只返回 task/summary。若这是强制需求，应在验收中单独测试，不要默认保证。

### 12.5 Headless permission

Cursor IDE 的交互式审批不能自动假设存在于 SDK/OMP。必须设计 sandbox、hooks 或 OMP UI policy。

### 12.6 Local 与 Cloud 不是同一种交互

Cloud 适合 durable background job，但不能直接修改 OMP 当前本地目录，也不能提供与 local `run.steer()` 相同的实时控制。

## 13. 最终建议

### 首选

**直接 fork `fitchmultz/pi-cursor-sdk`，以最新主干为代码基线，维护独立的 OMP port 分支，升级到目标 OMP/SDK 版本，使用独立 `cursor-sdk` provider，并通过 OMP 原生 `task` 暴露成 Cursor worker。**

新 port 保留 Cursor 的动态 prompt、Agent loop、原生工具、MCP、Skills、Rules 和多轮 session。OMP tools、MCP、Skills 通过配置可控的 loopback bridge 提供，默认关闭，关闭时不注入任何 OMP surface。

### 次选

**官方 `agent acp` + ACP client adapter。**

适合 SDK runtime/兼容性无法解决时，但接受 cancel+follow-up 替代 live steer，且自行处理 permissions、session persistence、rendering。

### Cloud 选项

**官方 Cloud SDK/API** 只用于 issue→PR 或长时间后台任务，不作为当前工作树的交互式 OMP subagent。

### 排除

- 当前 OMP 内置 Cursor subscription provider；
- 私有 endpoint reverse proxy；
- OpenAI-compatible Cursor proxy；
- 账号轮换；
- IDE token 提取；
- 只用 MCP 包装 CLI 来假装完整 Cursor subagent。

一句话：**用 Cursor 官方 SDK 跑完整 agent，用 OMP task 管生命周期和 Agent Hub，用 extension 做事件/steer 桥接；不要把 Cursor 当成可以任意转发的裸模型 API。**

## 14. 关键来源索引

### Cursor 官方

- [TypeScript SDK](https://cursor.com/docs/sdk/typescript)
- [Python SDK](https://cursor.com/docs/sdk/python)
- [SDK Bridge docs](https://cursor.com/docs/sdk/bridge)
- [SDK Cookbook](https://github.com/cursor/cookbook)
- [CLI using](https://cursor.com/docs/cli/using)
- [CLI headless](https://cursor.com/docs/cli/headless)
- [CLI parameters](https://cursor.com/docs/cli/reference/parameters)
- [CLI authentication](https://cursor.com/docs/cli/reference/authentication)
- [CLI output format](https://cursor.com/docs/cli/reference/output-format)
- [CLI configuration/proxy](https://cursor.com/docs/cli/reference/configuration)
- [CLI MCP](https://cursor.com/docs/cli/mcp)
- [CLI ACP](https://cursor.com/docs/cli/acp)
- [Agent Skills](https://cursor.com/docs/skills)
- [Cloud Agents API](https://cursor.com/docs/cloud-agent/api/endpoints)
- [Terms of Service](https://cursor.com/en-US/terms-of-service)
- [Acceptable Use Policy](https://cursor.com/en-US/acceptable-use-policy)
- [官方论坛员工回答](https://forum.cursor.com/t/using-cursor-frontier-models-like-composer-2-5-in-external-harnesses-e-g-codex/164676/5)

### OMP 官方

- [OMP repository](https://github.com/can1357/oh-my-pi)
- [OMP task](https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/tools/task.md)
- [OMP Agent Hub](https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/agent-hub.md)
- [OMP extensions](https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/extensions.md)
- [OMP extension loading](https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/extension-loading.md)
- [OMP task agent discovery](https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/task-agent-discovery.md)
- [OMP environment variables](https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/environment-variables.md)
- [OMP provider docs](https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/providers.md)
- [OMP provider streaming internals](https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/provider-streaming-internals.md)
- [OMP current Cursor provider source](https://github.com/can1357/oh-my-pi/blob/main/packages/ai/src/providers/cursor.ts)
- [OMP current Cursor OAuth source](https://github.com/can1357/oh-my-pi/blob/main/packages/ai/src/registry/oauth/cursor.ts)

### 项目和协议参考

- [LoneExile/omp-cursor-sdk](https://github.com/LoneExile/omp-cursor-sdk)
- [fitchmultz/pi-cursor-sdk](https://github.com/fitchmultz/pi-cursor-sdk)
- [raphaelluethy/cursor-acp](https://github.com/raphaelluethy/cursor-acp)
- [cursor/sdk-bridge](https://github.com/cursor/sdk-bridge)
- [agentclientprotocol/typescript-sdk](https://github.com/agentclientprotocol/typescript-sdk)
- [tageecc/cursor-agent-api-proxy](https://github.com/tageecc/cursor-agent-api-proxy)
- [anyrobert/cursor-api-proxy](https://github.com/anyrobert/cursor-api-proxy)
- [andreilungeanu/cursor-delegate-mcp](https://github.com/andreilungeanu/cursor-delegate-mcp)
- [JaimeJunr/cursor-mcp-bridge](https://github.com/JaimeJunr/cursor-mcp-bridge)
- [devshah7/cursor-cli-mcp](https://github.com/devshah7/cursor-cli-mcp)
- [thsunkid/orchestrate-cursor-agent-mcp](https://github.com/thsunkid/orchestrate-cursor-agent-mcp)
