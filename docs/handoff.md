# Handoff: OMP × Cursor 集成调研

## Next-session focus

继续推进“在 OMP 中以安全、官方方式运行 Cursor Agent”的兼容性验证和插件实现。用户已明确要求直接 fork `fitchmultz/pi-cursor-sdk`，再适配当前 OMP，不再把 `LoneExile/omp-cursor-sdk` 作为代码基线。

用户还要求 OMP tools、MCP、Skills bridge 默认关闭，只有显式配置后才提供给 Cursor。Cursor SDK 自己的动态 prompt、多轮上下文、Rules、Skills、MCP 和 native tools 默认保留。

## Current status

- 完整调研结果已保存到：[`cursor-omp-research.md`](./cursor-omp-research.md)
- 直接 fork 版实施计划已保存到：[`omp-cursor-sdk-direct-fork-plan.md`](./omp-cursor-sdk-direct-fork-plan.md)
- 本地目录已经执行 `git init`，当前分支为 `omp-port`；直接 fork 版 provider、OMP native task agent 和 bridge 默认关闭策略已实现。
- 已新增并打包 `agents/cursor.md`，以 `model: cursor-sdk/default` 注册 OMP task agent `cursor`。
- OMP 版本为 `18.1.13`；child session、Agent Hub、生命周期、外层 steer/cancel 继续由 OMP native task 提供。
- 本地 build、`typecheck:src`、`typecheck:tests`、package contract 和完整 Vitest 已通过；最新上下文/终结器回归为 46 tests passed。
- 已通过真实 OMP 18 `task(agent="cursor")` smoke：父会话成功通过 native `task` 派发，子任务解析为 `cursor-sdk/default`，Cursor 子会话通过 hidden `yield` 完成，Hub 结果为 `completed`，输出为 `OMP_TASK_SMOKE_OK`，父会话输出为 `OMP_PARENT_TASK_SMOKE_OK`。
- smoke 使用的 Cursor API key 只通过临时进程环境注入，没有写入仓库、OMP 配置或 auth DB；验证后应立即在 Cursor 侧撤销/删除该 key。

## Core decision

采用：

```text
直接 fork fitchmultz/pi-cursor-sdk
  + OMP 18 provider/extension 适配
  + 独立 cursor-sdk provider
  + OMP 原生 task 作为外层子代理/Agent Hub 包装
  + Cursor SDK event → OMP stream/renderers
  + OMP Hub steer → local run.steer()
  + 可选 OMP bridge，默认关闭
```

`LoneExile/omp-cursor-sdk` 只作为已有 OMP 适配、测试和失败经验的参考，不作为 Git 上游、依赖或嵌套 fork。

Cursor SDK 保留自己的动态 system prompt 和 Agent loop。OMP 只提供外层任务上下文，不覆盖 Cursor `systemPrompt`，也不重复注入 Cursor 自己的工具、Skills 和 Rules。

OMP bridge 采用显式配置，默认不暴露 OMP tools、MCP、Skills 或相关路径。Cursor 原生 tools、MCP、Skills、Rules 默认不受该开关影响。

备用方案是官方 `agent acp`；Cloud SDK/API 仅适合 issue→PR 或长期后台任务。

明确排除当前 OMP 内置 Cursor subscription provider、私有 endpoint reverse proxy、OpenAI-compatible Cursor proxy、账号轮换、IDE token 提取和 `CURSOR_ACCESS_TOKEN`。

## Non-negotiable constraints

1. 认证只能采用 Cursor API key 或 Teams/Enterprise service account API key；不能使用或迁移 `CURSOR_ACCESS_TOKEN`、IDE auth 文件或私有 OAuth token。
2. 官方 SDK 是完整 agent runtime，不是裸模型或 OpenAI `/v1/chat/completions` endpoint。
3. SDK `local` 表示本地 agent loop/文件系统，模型推理仍在 Cursor hosted service。
4. `Cursor.models.list()` 决定实际可用模型 ID 和参数；不要硬编码一个可能过时的 alias。
5. 默认通过标准 `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY`、必要时 `NODE_USE_ENV_PROXY=1` 配置代理；企业 TLS MITM 使用受信 CA，禁止关闭 TLS 校验。
6. HTTP/2 优先；HTTP/1.1/SSE 只作为企业代理兼容性 fallback，不是性能优化。
7. Headless SDK 没有 IDE 审批 UI；必须显式设计 sandbox、hooks、allowlist、超时和取消。
8. OMP `.omp/skills` 不会自动变成 Cursor Skills；只有打开 OMP Skills bridge 后，才通过受控 activation tool 按需提供。
9. OMP 同一工作树上的写任务应串行；并行任务使用 OMP `isolated:true`。
10. 任何“不会封号”的表述都不成立。官方员工把 CLI/SDK 定为官方 external agent 路径，但 Terms/AUP 文字仍然宽泛；企业或高价值账号应取得书面确认。
11. OMP bridge 默认关闭。关闭时不得注入 OMP tools、MCP catalog、Skills catalog、skill path 或 bridge guidance。
12. OMP bridge 开启后按 tools、MCP、Skills 分别控制；与 Cursor native tools 重叠的 OMP builtin tools 默认不暴露。
13. Cursor SDK Agent 必须跨兼容的 OMP turns 复用；配置、权限或 bridge surface 变化时重新建立 Agent。
14. 测试 smoke 固定使用 `default` 模型，不使用 `auto`；不要把 OMP 内置 `cursor/auto` 映射为 `cursor-sdk/auto`。

## Recommended next actions

1. 在设置 `CURSOR_API_KEY` 的环境中重跑真实 `task(agent="cursor")` smoke，验证 child session、Hub completion、Hub steer/cancel 和 `isolated:true` worktree。
2. 使用只读 prompt 先验证 Cursor SDK 原生 Rules、Skills、MCP、native tools 与多轮上下文，再在明确 allowlist 和 sandbox 下验证写操作。
3. 继续用 `cursor-sdk/default` 做 smoke；不要把 OMP 内置 `cursor/auto` 映射为 `cursor-sdk/auto`。
4. 认证仍只使用 Cursor API key 或 Teams/Enterprise service account API key；不引入 `CURSOR_ACCESS_TOKEN`、IDE auth 文件或私有 endpoint。
5. 本地实现已完成后，再按需要做 proxy HTTP/2、HTTP/1.1 fallback、企业 CA、MCP OAuth 和日志脱敏验证。

## Important implementation boundary

OMP 18 的公开 SDK 已导出 `AgentRegistry`、`createAgentSession` 和 `AgentSession`，但官方没有把 `TaskTool` executor 作为 extension 的独立 programmatic API。这个 fork 不复制 OMP executor，也不注册私有 registry seam；它提供打包到 `agents/cursor.md` 的 `cursor` task agent，交给 OMP 原生 task discovery：

- OMP 原生 `task(agent="cursor")` 负责 child session、Agent Hub、生命周期、外层 steer 和取消；
- agent frontmatter 将 child model 路由到 `cursor-sdk/default`；
- Cursor SDK Agent 负责 Cursor 原生动态 prompt、conversation、tools、MCP、Skills、Rules 和内部 agent loop；
- Cursor provider 已将 SDK assistant/thinking/tool/status/usage 事件映射到 OMP 当前 child session；
- OMP bridge 通过本地 loopback MCP 按配置暴露 OMP tools、MCP 和 Skills，默认完全关闭；
- bridge 关闭时不得把 OMP skill catalog 或 `SKILL.md` 路径注入 Cursor；
- Cursor 内部 subagent 不应承诺会自动成为 OMP Agent Hub 的独立节点；
- SDK native tool 可以展示，但默认不是 OMP 再次执行的 tool call；
- OMP 与 Cursor IDE 同时访问同一工作树时，bridge 开关不能替代写入并发控制。
完整事件映射、配置示意、版本差异、社区项目比较和验证清单在 [`cursor-omp-research.md`](./cursor-omp-research.md) 与 [`omp-cursor-sdk-direct-fork-plan.md`](./omp-cursor-sdk-direct-fork-plan.md)，不要在本交接文档中重复维护第二份细节。

## Suggested skills

下一对话若开始代码或架构工作，建议按需调用以下 Skill：

- `ponytail`：先强制选择最小实现，避免重新实现 Cursor agent loop 或引入不必要的 proxy/抽象。
- `codebase-design`：设计 OMP provider、SDK coordinator、Agent Hub 和 steer 的模块边界。
- `writing-for-agents`：只有在需要修改 `AGENTS.md`、agent frontmatter 或其他面向 agent 的规则文件时调用。
- `tdd`：如果用户要求 test-first，或 SDK event/steer 生命周期存在不确定行为时调用；测试应覆盖可观察契约而不是内部实现。
- `check` 或 `code-review`：插件完成后做安全、规格和版本兼容性审查；重点检查私有 Cursor auth/endpoint 是否意外回流。
- `diagnosing-bugs`：仅当兼容性 smoke test 出现实际失败、卡住、慢或事件丢失时调用。

## Source of truth

- 主调研文档：[`cursor-omp-research.md`](./cursor-omp-research.md)
- Cursor SDK 官方文档：<https://cursor.com/docs/sdk/typescript>
- Cursor CLI/ACP 官方文档：<https://cursor.com/docs/cli/acp>
- Cursor 官方外部 harness 回答：<https://forum.cursor.com/t/using-cursor-frontier-models-like-composer-2-5-in-external-harnesses-e-g-codex/164676/5>
- OMP task 文档：<https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/tools/task.md>
- OMP extension 文档：<https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/extensions.md>
