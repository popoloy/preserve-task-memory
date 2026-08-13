# Preserve Task Memory for Codex（Codex 任务记忆保持）

一个用于 Codex 的 skill 与生命周期钩子，在上下文压缩（context compaction）期间保持长时间运行任务的关键状态。

skill 与钩子**全局安装一次**（Codex Home 下），而每个 Git 仓库各自在 `.codex/task-memory/` 下保存隔离的运行时状态。它会自动在会话之外初始化简洁的检查点（checkpoint），以 Codex 会话 id 为键，并在启动、恢复或压缩后自动恢复最新状态摘要（capsule）。不依赖任何外部模型 API 或数据库。核心是一个零依赖的 Node.js ES 模块，仅使用跨平台的标准库 API；只要 `PATH` 中可用 `node`，即可在 Windows、Linux 和 macOS 上运行。

## 它保存了什么

- 目标（Objective）与完成定义（Definition of Done）
- 用户约束与技术决策（支持优先级与生命周期管理）
- 已完成的工作与验证证据
- 当前状态、阻塞项与下一步动作
- 相关文件路径
- 最近一轮的收尾摘要（由 `Stop` 钩子自动记录）

运行时状态存储在仓库的 `.codex/task-memory/` 下，且已从 Git 中排除。

## 仓库结构

```text
.agents/skills/preserve-task-memory/
  SKILL.md
  agents/openai.yaml
  scripts/memory.mjs
  scripts/hook-runner.cjs
  scripts/install-global.mjs
```

仓库内的 `.codex/hooks.json` 是空的——钩子通过全局安装脚本注册到 Codex Home。

运行时会在仓库 `.codex/task-memory/` 下自动生成：
- `sessions/<session-id>/` — 每个会话的状态（`state.json`、`capsule.md`、`events.jsonl`）
- `project-profile.json` — 轻量项目档案（自动检测技术栈、脚本命令、关键路径）

## 安装

将 skill 与钩子安装到 Codex Home（`CODEX_HOME` 或 `~/.codex`）：

```shell
npm run install:global
# 等价于：node .agents/skills/preserve-task-memory/scripts/install-global.mjs install
```

- 安装会复制 skill 到 `<codex-home>/skills/preserve-task-memory/`，并把钩子**合并**到 `<codex-home>/hooks.json`，保留你已有的无关钩子。
- 卸载：`node .agents/skills/preserve-task-memory/scripts/install-global.mjs uninstall`

## 使用方法

1. 安装完成后，从任意 Git 仓库根目录启动 Codex 即可。
2. 钩子会自动初始化状态、保存脱敏后的用户提示词，并记录机械性的工具活动。
3. 当需要整合语义决策与里程碑时，显式调用 `$preserve-task-memory`，或让 Codex 自行选择它。

手动初始化是可选的，用于设置显式的目标或完成定义（命令中的 `<codex-home>` 为 `CODEX_HOME` 或 `~/.codex`）：

```shell
node "<codex-home>/skills/preserve-task-memory/scripts/memory.mjs" init \
  --session-id "<会话 id>" \
  --objective "<目标>" \
  --done-criteria "<完成定义>"
```

记录一个有意义的关键事件：

```shell
node "<codex-home>/skills/preserve-task-memory/scripts/memory.mjs" checkpoint \
  --session-id "<会话 id>" \
  --current "<当前阶段>" \
  --completed "<已完成项>" \
  --next "<下一步动作>" \
  --evidence "<验证信息>" \
  --status active
```

检查点条目支持优先级、主题与生命周期管理：

```shell
# 标记优先级 / 归属主题 / 同一主题新决策自动取代旧决策
node "<codex-home>/skills/preserve-task-memory/scripts/memory.mjs" checkpoint \
  --session-id "<会话 id>" --decision "<新决策>" \
  --topic "<主题>" --priority critical --merge

# 将某主题下的旧条目标记为已过时/已解决
node "<codex-home>/skills/preserve-task-memory/scripts/memory.mjs" lifecycle \
  --session-id "<会话 id>" --topic "<主题>" --lifecycle resolved
```

其他动作：
- `show` — 打印当前记忆摘要
- `list` — 列出工作区内的所有会话
- `validate` — 校验状态与摘要大小
- `profile` — 查看、刷新或更新项目档案（`--refresh` / `--technology` / `--key-path` / `--fact`）
- `search` — 本地检索记忆：`--query` 必填，`--mode bm25`（默认，带优先级加权）或 `--mode text`（子串匹配），支持 `--session-id` / `--kind` / `--include-inactive` / `--limit`

不带动作直接运行脚本可查看命令帮助。

## 仓库范围（Repository Scope）

- 自动钩子**只在 Git 工作树内运行**；通过 `git rev-parse --show-toplevel` 解析仓库根（支持 worktree），状态存放到对应的仓库根。
- 为单个仓库**禁用**自动记忆：在仓库根创建 `.codex/task-memory.json`，写入 `{ "enabled": false }`。
- 保持 `.codex/task-memory/` 不被 Git 跟踪，且**不会**自动修改仓库的忽略规则。

## 行为说明

- `SessionStart`：在启动、恢复以及压缩后续跑时，创建缺失的状态并注入最新项目档案与状态摘要。
- `UserPromptSubmit`：保存每条用户请求的一份脱敏、有界副本，并将第一条请求采纳为临时目标。
- `PostToolUse`：记录有界的机械性活动与显式文件字段，不存储 shell 命令或完整的工具输出。
- `PreCompact`：在压缩前写入一个确定性的恢复检查点。
- `Stop`：会话结束时，把最后一条助手消息记为高优先级收尾摘要；它**不会**推断任务完成，完成仍需显式 `--status complete`。
- 条目化存储：每条记录带 `priority`（critical/high/normal/low）与 `lifecycle`（active/superseded/resolved/stale/expired），可按主题归并、按优先级排序展示。
- 状态摘要上限为 6,000 字符，以限制上下文占用。
- 常见凭据模式在存储前会被打码（redact）。
- 状态写入是原子的，并由每个会话独立的锁保护。
- 已存储的记忆仅作为恢复指引，使用前应与当前工作区核对。

自动捕获刻意**不会**从工具输出推断决策理由、完成状态或测试是否成功。这些事实仍由 Codex 通过语义检查点来记录；但即使遗漏了某个语义检查点，会话最近的请求与机械性活动也不会丢失。

`search` 与 `profile` 均完全本地运行，不依赖外部检索服务或嵌入（embedding）API；摘要截断后仍可通过 `search` 找回历史信息。
