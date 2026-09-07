# AI_WORKFLOW

这个目录是 ChatGPT 与 Codex 围绕 YesPlayMusic KTV 改造的持久化交互层。

## 目的

- 不依赖某一个长对话窗口保存项目状态。
- 让每轮实现、审查、决策都有仓库文件可追溯。
- 以真实代码和测试为准，不以 Agent 自述为准。

## 每次 Codex 开始任务前

按顺序阅读：

1. `PROJECT_STATE.md`
2. `DECISIONS.md`
3. 当前 `TASKS/*.md`
4. 当前 `PROMPTS/*.md`
5. 最近一份 `REVIEWS/CHATGPT_*.md`（若存在）

## 每次 Codex 完成任务后

必须：

1. 更新 `PROJECT_STATE.md`。
2. 创建/更新对应 `REPORTS/CODEX_*.md`。
3. 更新 `CHANGELOG.md`。
4. 明确列出修改文件、测试命令、测试结果、未验证项。
5. commit 并 push 到任务指定分支。

## ChatGPT 审查规则

审查事实优先级：GitHub 实际代码 > 测试/构建证据 > PROJECT_STATE > Codex Report > Agent 叙述。

ChatGPT 后续会基于 GitHub 分支检查真实实现，并生成新的 Review/Prompt 文件给下一轮 Codex 使用。
