# OMP Cursor SDK 直接 Fork 集成计划

## 1. 目标

从 `fitchmultz/pi-cursor-sdk` 的最新主干直接建立 OMP fork，不再以 `LoneExile/omp-cursor-sdk` 作为代码基线。`LoneExile/omp-cursor-sdk` 只作为已有 OMP 适配和测试经验的参考来源。

目标运行方式：

- Cursor SDK 保留自己的 Agent loop、动态 system prompt、Rules、Skills、MCP、native tools 和多轮上下文；
- OMP 负责外层 session、task、Agent Hub、生命周期、显示和取消；
- OMP tools、MCP、Skills 通过可选的本地 MCP bridge 提供给 Cursor；
- OMP bridge 默认关闭，只有显式配置后才暴露；
- 认证只使用 Cursor API key 或 service account API key；
- 不使用 `CURSOR_ACCESS_TOKEN`、IDE/CLI 登录态、私有 OAuth 或 OpenAI-compatible proxy。

## 2. 当前基线和已知事实

### 2.1 版本

已观察到的本机版本：

```text
OMP: 18.1.13
Bun: 1.4.2
Node: 22.22.2
```

当前已安装插件：

```text
omp-cursor-sdk: 0.3.3
@cursor/sdk: 1.0.23
```

上游 `fitchmultz/pi-cursor-sdk` 当前主干已到 `0.3.6`，依赖 `@cursor/sdk@1.0.27`，Pi peer dependencies 使用通配版本。现有 OMP port 仍依赖 `@oh-my-pi/*@17.3.0`，与当前 OMP 18 存在版本差距。

### 2.2 已完成验证

- OMP 插件安装、加载和 `omp plugin doctor` 通过；
- Cursor 动态模型发现通过；
- Cursor 官方 API key 通过 `Cursor.me` 和 `Cursor.models.list()` 验证；
- 官方 SDK 模型列表缓存包含 `default`，未包含 `auto`；`omp models --json` 的内置 `cursor` provider 另有 `cursor/auto`，不作为新 `cursor-sdk` provider 的依据；
- 官方 `@cursor/sdk` local Agent 在 Bun 和 Node 下完成基础 prompt；
- SDK 自定义 SQLite session store 完成基础 prompt；
- 当前插件通过 OMP 发起实际 Cursor turn 仍返回 `ERROR_NOT_LOGGED_IN`；
- 显式 API key、隔离 profile、关闭代理和显式加载插件均未解决该 OMP turn 失败；
- 当前失败更像 OMP host/provider/runtime 兼容问题，不能归因于 API key 无效。

### 2.3 当前 Git 状态

本地目录已经执行 `git init`，没有需要保留的原始项目提交历史。后续仓库应直接基于用户自己的 `fitchmultz/pi-cursor-sdk` fork，使用独立的 OMP port 分支。

推荐远程关系：

```text
origin   = 用户自己的直接 fork
upstream = https://github.com/fitchmultz/pi-cursor-sdk.git
```

`LoneExile/omp-cursor-sdk` 不作为依赖、上游或嵌套 fork。

## 3. 总体架构

```text
OMP 主会话
  │
  └── OMP native task / Cursor child session
        │
        └── 长期存活的 Cursor SDK Agent
              │
              ├── Cursor 动态 system prompt
              ├── Cursor Rules / Skills / MCP / native tools
              ├── 可选 OMP MCP bridge
              │     ├── OMP tools
              │     ├── OMP MCP
              │     └── OMP Skills
              └── SDK Run stream / steer / cancel / resume
```

职责划分：

| 模块 | 所有者 | 职责 |
|---|---|---|
| OMP task/session | OMP | 外层任务、session、生命周期和 Agent Hub |
| Cursor SDK Agent | Cursor SDK | prompt、conversation、workspace、native tools |
| OMP bridge | OMP fork | 可选的 tools/MCP/Skills 暴露和调用回传 |
| event coordinator | OMP fork | SDK event 到 OMP stream/renderers 的映射 |
| provider adapter | OMP fork | OMP provider、model、认证和 turn 接口 |

Cursor native tool replay 只用于展示，不得让 OMP 重新执行 Cursor 已执行的命令、编辑或 MCP 调用。

## 4. Cursor 原生 prompt 和多轮会话

### 4.1 保留 Cursor 动态 prompt

创建 Agent 时不传自定义 `systemPrompt`，让 SDK 使用自己的默认 system prompt：

```typescript
const agent = await Agent.create({
  apiKey,
  model,
  mode: "agent",
  local: {
    cwd,
    settingSources: ["all"],
  },
});
```

OMP 只向 Cursor 发送：

- 当前用户任务；
- 必要的 OMP 任务上下文；
- 最小的工具 surface 说明；
- 当前 OMP task 的约束。

不得把 OMP 完整 system prompt、工具清单和 Skills 内容重复拼接到 Cursor 的 system prompt。

### 4.2 长期存活的 Agent

每个 OMP child/session 维护一个稳定的 Cursor Agent：

```text
OMP session id
+ cwd
+ model
+ settings
+ auth identity
+ bridge surface
→ Cursor Agent
```

一个 OMP turn 对应一个 Cursor `Run`：

```text
Run 1: 分析任务
Run 2: 开始修改
Run 3: 根据测试结果修复
Run 4: 总结
```

后续 turn 使用同一个 Agent 的 `agent.send()`，不得每轮重新创建 Agent。进程重启后使用 `Agent.resume()` 和相同的 store identity 恢复。

### 4.3 OMP follow-up 和 steer

- 当前 Run 仍在执行时，OMP Hub 输入优先映射到 `run.steer()`；
- SDK 不接受 live steer 时，等待当前 Run 结束后用 `agent.send()` 作为明确降级；
- OMP cancel 映射到 `run.cancel()`；
- bridge surface 和 setting sources 进入 Agent pool key，避免复用错误权限上下文的 Agent；
- bridge 配置变更从下一个 Run 生效；需要立即收回权限时，先 cancel 当前 Run，再创建新 Agent。

## 5. OMP bridge 设计

### 5.1 默认关闭

新 OMP fork 不沿用上游 `PI_CURSOR_PI_TOOL_BRIDGE` 默认开启的行为。默认状态必须是关闭，并且关闭表示完全隔离：

- Cursor MCP catalog 中没有 OMP MCP；
- Cursor tool catalog 中没有 OMP tools；
- Cursor prompt 中没有 OMP Skills catalog、OMP skill 路径或 bridge guidance；
- 不注册 `omp__*` bridge tool；
- Cursor native tools、Cursor native MCP、Cursor native Skills/Rules 保持不变。

不能只做到“工具注册了但禁止调用”。默认关闭时，OMP surfaces 不应进入 Cursor 可观察上下文。

### 5.2 配置接口

用户级配置建议放在：

```text
~/.omp/agent/cursor-sdk.json
```

项目级配置建议放在：

```text
.omp/cursor-sdk.json
```

项目级配置只有在 OMP trust 完成后生效。

最小关闭配置：

```json
{
  "ompBridge": {
    "enabled": false
  }
}
```

开启全部 OMP surfaces：

```json
{
  "ompBridge": {
    "enabled": true
  }
}
```

只开启 OMP MCP：

```json
{
  "ompBridge": {
    "enabled": true,
    "tools": false,
    "mcp": true,
    "skills": false
  }
}
```

配置语义：

- `enabled` 默认 `false`；
- `enabled: true` 时，未显式指定的 `tools`、`mcp`、`skills` 默认开启；
- 显式设置为 `false` 的 surface 保持关闭；
- `exposeOverlappingBuiltins` 默认 `false`，不得由 `enabled` 自动开启；
- 未知配置值 fail closed，不改变现有权限。

建议的一次性环境变量：

```text
PI_CURSOR_OMP_BRIDGE
PI_CURSOR_OMP_BRIDGE_TOOLS
PI_CURSOR_OMP_BRIDGE_MCP
PI_CURSOR_OMP_BRIDGE_SKILLS
PI_CURSOR_OMP_BRIDGE_BUILTINS
```

配置优先级：

```text
CLI
→ environment
→ session
→ trusted project
→ user config
→ built-in default false
```

### 5.3 OMP tools

通过本地 loopback MCP 暴露带 `omp__` 前缀的工具，例如：

```text
omp__subagent
omp__cursor_ask_question
omp__example-tool
```

调用流程：

```text
Cursor SDK MCP call
  → loopback MCP bridge
  → OMP tool_call
  → OMP tool execution
  → OMP tool_result
  → 当前 Cursor Run
```

bridge 不直接调用 OMP tool handler，而是复用 OMP 正常的 tool lifecycle、权限、hook、renderer、abort 和 result 流程。

以下重复工具默认不暴露：

```text
read
bash
write
edit
grep
find
ls
```

Cursor SDK 已经提供这些 native tools。只有显式设置 `exposeOverlappingBuiltins: true` 时才允许重复暴露。

### 5.4 OMP MCP

OMP MCP 通过一个受控的 bridge 入口提供，例如：

```text
omp__mcp
```

MCP server 的选择、认证、timeout、cancel 和生命周期由 OMP 管理。不要把 OMP MCP 配置和凭据复制到 Cursor 的 `.cursor/mcp.json`。

bridge 关闭时不得把 OMP MCP server 名称、路径或凭据注入 Cursor。

### 5.5 OMP Skills

OMP Skills 只在 `skills` surface 开启时暴露：

```text
OMP skill catalog
  → omp__activate_skill
  → SKILL.md 内容
  → skill directory
  → 有界的 scripts/references/assets 清单
```

bridge 关闭时必须同时关闭：

- OMP skill catalog 注入；
- OMP `SKILL.md` 路径注入；
- OMP skill activation tool；
- OMP skill prompt guidance。

Cursor 自己的 Skills 继续通过 Cursor SDK 的 setting sources 原生加载。

## 6. Provider 和认证

### 6.1 独立 provider

新 OMP fork 对外注册：

```text
cursor-sdk
```

不覆盖 OMP 内置 `cursor` provider，避免注册顺序和旧 transport 冲突。

用户模型 selector 采用：

```text
cursor-sdk/default
```

所有 provider turn 必须明确使用 Cursor SDK local runtime，不得回退到旧 Cursor subscription transport。

### 6.2 认证策略

只支持：

- 显式 `apiKey`；
- `CURSOR_API_KEY`；
- OMP 官方 credential resolver 中保存的 API key；
- SDK 版本提供的官方 `Cursor.auth.login()`，其结果仍然是 SDK API key。

不支持：

- `CURSOR_ACCESS_TOKEN`；
- Cursor IDE 或 CLI 登录态；
- 私有 OAuth token；
- IDE auth 文件；
- token 提取和转换。

当前安装的 `@cursor/sdk@1.0.23` 没有公开 `Cursor.auth`。后续若升级到公开该接口的版本，也只使用其官方 API key 登录流程。

## 7. 实施阶段

### 阶段一：直接 fork 和 OMP 18 基础适配

目标是得到一个可独立安装、可编译、可完成基础 Cursor turn 的 OMP 插件。

工作内容：

1. 以 `fitchmultz/pi-cursor-sdk` 最新主干建立用户 fork；
2. 建立 `omp-port` 分支；
3. 更新 package manifest、build entry 和 lockfile；
4. 将 Pi 类型和 extension import 适配到 OMP 18；
5. 注册独立 `cursor-sdk` provider；
6. 保留 `Cursor.models.list()` 动态模型发现；
7. 接入 OMP API key resolver；
8. 禁止旧 Cursor provider、旧 OAuth 和 `CURSOR_ACCESS_TOKEN` fallback；
9. 完成一次 OMP local Agent prompt smoke。

阶段完成后，用户可以在 OMP 里选择 `cursor-sdk` 并完成基础对话。

### 阶段二：Cursor 原生多轮 Agent

工作内容：

1. 保留 Cursor 默认 system prompt；
2. 接入 `settingSources`，让 Cursor 原生加载 Rules、Skills、MCP；
3. 复用同一个 Cursor Agent 跨 OMP turns；
4. 接入持久化 store 和 `Agent.resume()`；
5. 处理 OMP session branch、cwd、model、settings 和 auth identity；
6. 映射 assistant、thinking、tool、status、task、usage events；
7. 接入 `run.steer()` 和 `run.cancel()`；
8. 确保 Cursor native tool replay 不会重新执行。

阶段完成后，Cursor 的 prompt 和多轮上下文在 OMP 中保持原生语义。

### 阶段三：OMP bridge 默认关闭和按 surface 开启

工作内容：

1. 增加 `ompBridge` 配置解析；
2. 将 bridge 默认值设为 `false`；
3. 分离 tools、MCP、Skills 三类 surface；
4. bridge 关闭时删除所有 OMP catalog、path 和 prompt guidance；
5. bridge 开启时使用 `omp__*` 命名空间；
6. 默认隐藏和 Cursor 重叠的 OMP builtin tools；
7. 将 OMP tool call 接回正常 OMP lifecycle；
8. 将 OMP MCP credentials 留在 OMP 侧；
9. 增加 OMP Skills 按需激活和资源数量限制；
10. 将 bridge surface 纳入 Agent pool/session key。

阶段完成后，用户可以只开启缺失的 OMP 能力，不影响 Cursor IDE 自己的 MCP、Skills 和 tools。

### 阶段四：OMP native task 和 Agent Hub

工作内容：

1. 注册可被 OMP task discovery 找到的 Cursor agent type；
2. 用 OMP native task 创建 Cursor child session；
3. 将 Cursor Agent 映射到 Agent Hub row；
4. 显示 model、状态、token、thinking、tool 和 assistant stream；
5. 将 Hub steer 映射到当前 `run.steer()`；
6. 将 Hub cancel 映射到当前 `run.cancel()`；
7. 处理 task 完成、失败、cancel 和 session shutdown；
8. 对 `isolated:true` task 传递正确的 `cwd` 和 worktree；
9. 确保没有 orphan run、MCP server、timer 或 child process。

阶段完成后，Cursor 才能作为 OMP 原生子代理出现，而不是只作为当前主会话的 provider。

当前实现已完成最小接入边界：`agents/cursor.md` 注册 OMP task agent `cursor`，并通过 `model: cursor-sdk/default` 复用现有 provider。child session、Agent Hub、生命周期和取消继续由 OMP native task ownership 提供；Cursor 内部 subagent 不映射为 OMP Hub 节点。真实 `task(agent="cursor")`、Hub steer/cancel、isolated worktree 仍需在安装后的 OMP 18 smoke 中验证。

### 阶段五：代理、安全和发布验收

工作内容：

1. 验证 HTTP/2 代理路径；
2. 验证 HTTP/1.1/SSE fallback；
3. 验证企业 CA 和 TLS 校验；
4. 验证 `NO_PROXY` 不影响 loopback MCP；
5. 限制 headless tool 权限，默认使用 sandbox/allowlist 策略；
6. 验证 timeout、cancel 和 shutdown 清理；
7. 日志只记录脱敏后的 tool、状态和时延信息；
8. 不记录 API key、access token、cookie、MCP secret、文件内容或原始 tool args；
9. 通过打包安装测试后再替换全局插件；
10. 保留旧全局安装作为回滚基线，不直接修改其 `node_modules`。

## 8. 验收矩阵

### 8.1 基础能力
测试 smoke 固定使用 `default`，不使用 `auto`，也不默认固定到具体 Composer 或其他模型。

- [ ] `omp plugin doctor` 通过；
- [ ] OMP 18 typecheck/build 通过；
- [ ] `cursor-sdk` provider 可以加载；
- [ ] `Cursor.models.list()` 可以刷新模型目录；
- [ ] `cursor-sdk/default` 可以完成实际 prompt；
- [ ] 只设置 `CURSOR_API_KEY` 即可运行；
- [ ] 只设置 `CURSOR_ACCESS_TOKEN` 时 fail closed，并给出 API key 提示；
- [ ] provider 不会调用 OMP 内置 `cursor` transport。

### 8.2 Cursor 原生能力

- [ ] Cursor 默认 system prompt 未被替换；
- [ ] Cursor project/user Rules 能被加载；
- [ ] Cursor native Skills 能被加载；
- [ ] Cursor native MCP 能被加载；
- [ ] Cursor native tools 能执行并正确显示 replay；
- [ ] 两个连续 OMP turns 使用同一个 Cursor Agent；
- [ ] `Agent.resume()` 能恢复上下文；
- [ ] `run.steer()` 能改变运行中的任务；
- [ ] `run.cancel()` 能终止运行；
- [ ] usage、thinking、tool、status、assistant event 不丢失或重复。

### 8.3 OMP bridge 默认关闭

- [ ] 默认没有 `omp__*` tool；
- [ ] 默认没有 OMP MCP catalog；
- [ ] 默认没有 OMP Skills catalog；
- [ ] 默认没有 OMP skill path 或 activation guidance；
- [ ] Cursor 自己的 MCP、Skills、Rules 仍然可用；
- [ ] OMP 重叠 builtin tools 默认不暴露。

### 8.4 OMP bridge 按 surface 开启

- [ ] 只开 tools 时只能看到 OMP tools；
- [ ] 只开 MCP 时只能看到 OMP MCP bridge；
- [ ] 只开 Skills 时只能看到 OMP skill catalog 和 activation tool；
- [ ] tools、MCP、Skills 组合开关互不误开；
- [ ] OMP bridge tool call 走正常 OMP tool lifecycle；
- [ ] bridge tool result 返回同一个 Cursor Run；
- [ ] bridge cancel 不留下 pending call；
- [ ] Skills 资源数量有界，路径不能越出 skill directory；
- [ ] OMP MCP credentials 不复制到 Cursor 配置；
- [ ] 配置关闭后新 Run 不再看到 OMP surfaces。

### 8.5 OMP task/Hub

- [ ] `task(agent="cursor")` 能创建 child；
- [ ] Agent Hub 显示 child、model、状态和 usage；
- [ ] assistant、thinking、tool、status 能正确渲染；
- [ ] Hub steer 调用 `run.steer()`；
- [ ] Hub cancel 调用 `run.cancel()`；
- [ ] task 结束后无 orphan stream/process；
- [ ] isolated worktree 使用正确的 Cursor `cwd`；
- [ ] Cursor 内部 nested subagent 不被错误声称为 OMP Hub 独立节点。

### 8.6 网络和安全

- [ ] HTTP/2 proxy 成功；
- [ ] HTTP/1.1/SSE fallback 成功；
- [ ] 企业 CA 正确验证 TLS；
- [ ] loopback MCP 不被 `NO_PROXY` 破坏；
- [ ] API key 不进入日志、prompt、session transcript 或普通配置；
- [ ] 禁止 `CURSOR_ACCESS_TOKEN`、旧 OAuth 和 private OMP token fallback；
- [ ] headless 写操作有明确 sandbox、allowlist、timeout 和 cancel policy。

## 9. 回滚

回滚不需要数据迁移：

1. 禁用新插件或恢复旧插件版本；
2. 保留 `ompBridge.enabled: false` 作为默认安全状态；
3. 保留旧全局插件和旧模型缓存作为基线；
4. 不删除用户 session store；
5. 不删除 Cursor SDK agent，除非经过明确的、针对具体 agent ID 的清理流程；
6. 不修改或删除 OMP auth DB。

当前已安装的旧 `omp-cursor-sdk` 不作为新代码工作区，也不直接编辑其 `node_modules`。

## 10. 非目标

- 不实现 OpenAI-compatible Cursor proxy；
- 不复刻 Cursor private endpoint；
- 不导入 Cursor IDE/CLI access token；
- 不把 Cursor SDK 降级为裸模型 API；
- 不默认把 OMP tools、MCP 或 Skills 注入 Cursor；
- 不让 Cursor replay 在 OMP 中重复执行；
- 不保证 Cursor 内部 nested subagent 自动成为 OMP Hub 节点；
- 不把 Cloud runtime 作为当前本地工作树的默认执行路径；
- 不允许多个写入 Agent 无约束地并发修改同一工作树。

## 11. 关键风险和前提

### 11.1 OMP 18 provider API

本计划假设 OMP 18 的公开 extension/provider API 可以注册独立 `cursor-sdk` provider，并允许 provider 自己持有 SDK Agent 生命周期。如果该假设不成立，应把 Cursor SDK 放到 OMP native task 的外部 worker seam，而不是继续覆盖 provider。

### 11.2 SDK 与 OMP runtime

`@cursor/sdk` 版本升级可能改变 event shape、MCP timeout、local store、Bun/Node 行为和 native binary 要求。每次升级必须重新运行基础 turn、stream、bridge 和 resume smoke。

### 11.3 同一工作树并发

bridge 开关只能解决 tool surface 冲突，不能解决 Cursor IDE 和 OMP 同时写入同一文件的问题。写任务必须串行，或使用独立 worktree。

### 11.4 用户 fork 信息

实施远程 fork 和发布前需要用户确定 GitHub fork 的仓库名及 `origin` URL。该信息由用户负责，代码适配本身不依赖嵌套 fork。

## 12. 参考来源

- [fitchmultz/pi-cursor-sdk](https://github.com/fitchmultz/pi-cursor-sdk)
- [pi-cursor-sdk tool surfaces](https://github.com/fitchmultz/pi-cursor-sdk/blob/main/docs/cursor-tool-surfaces.md)
- [Cursor TypeScript SDK](https://cursor.com/docs/sdk/typescript)
- [OMP task 文档](https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/tools/task.md)
- [OMP Agent Hub 文档](https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/agent-hub.md)
- [OMP extension 文档](https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/extensions.md)
- [现有 OMP/Cursor 调研](./cursor-omp-research.md)
- [交接文档](./handoff.md)
