# Preserve Task Memory for Codex（Codex 任务记忆保持）

一个仓库级的 Codex skill 与生命周期钩子，用于在上下文压缩（context compaction）期间保持长时间运行任务的关键状态。

它会自动在会话之外初始化简洁的检查点（checkpoint），以 Codex 会话 id 为键，并在启动、恢复或压缩后自动恢复最新状态摘要（capsule）。不依赖任何外部模型 API 或数据库。

## 它保存了什么

- 目标（Objective）与完成定义（Definition of Done）
- 用户约束与技术决策
- 已完成的工作与验证证据
- 当前状态、阻塞项与下一步动作
- 相关文件路径

运行时状态存储在 `.codex/task-memory/` 下，且已从 Git 中排除。

## 仓库结构

```text
.agents/skills/preserve-task-memory/
  SKILL.md
  agents/openai.yaml
  scripts/memory.mjs
  scripts/hook-runner.cjs
.codex/hooks.json
```

## 使用方法

1. 克隆本仓库，并从仓库根目录启动 Codex。
2. 打开 `/hooks`，审查并信任项目钩子。
3. 然后正常继续工作。钩子会自动初始化状态、保存脱敏后的用户提示词，并记录机械性的工具活动。
4. 当需要整合语义决策与里程碑时，显式调用 `$preserve-task-memory`，或让 Codex 自行选择它。

手动初始化是可选的，用于设置显式的目标或完成定义：

```shell
node ".agents/skills/preserve-task-memory/scripts/memory.mjs" init \
  --session-id "<会话 id>" \
  --objective "<目标>" \
  --done-criteria "<完成定义>"
```

记录一个有意义的里程碑：

```shell
node ".agents/skills/preserve-task-memory/scripts/memory.mjs" checkpoint \
  --session-id "<会话 id>" \
  --current "<当前阶段>" \
  --completed "<已完成项>" \
  --next "<下一步动作>" \
  --evidence "<验证信息>" \
  --status active
```

其他动作包括 `show`、`list` 和 `validate`。不带动作直接运行脚本可查看命令帮助。

## 行为说明

- `SessionStart`：在启动、恢复以及压缩后续跑时，创建缺失的状态并注入最新的状态摘要。
- `UserPromptSubmit`：保存每条用户请求的一份脱敏、有界副本，并将第一条请求采纳为临时目标。
- `PostToolUse`：记录有界的机械性活动与显式文件字段，不存储 shell 命令或完整的工具输出。
- `PreCompact`：在压缩前写入一个确定性的恢复检查点。
- 状态摘要上限为 6,000 字符，以限制上下文占用。
- 常见凭据模式在存储前会被打码（redact）。
- 状态写入是原子的，并由每个会话独立的锁保护。
- 已存储的记忆仅作为恢复指引，使用前应与当前工作区核对。

自动捕获刻意**不会**从工具输出推断决策理由、完成状态或测试是否成功。这些事实仍由 Codex 通过语义检查点来记录；但即使遗漏了某个语义检查点，会话最近的请求与机械性活动也不会丢失。

核心是一个零依赖的 Node.js ES 模块，仅使用跨平台的标准库 API。只要 `PATH` 中可用 `node`，同一套钩子配置即可在 Windows、Linux 和 macOS 上运行。
