中文 | [English](docs/changelog/CHANGELOG_en.md)

# Changelog

## [0.9.1]

### Features
- 任务级 Profile 模型切换：ModelSwitcher 可按任务隔离 API 配置，避免多窗口会话串用模型配置
- OpenAI Native / OpenAI Codex 模型数据更新：同步官方模型信息，并补充 thinking / reasoning 相关配置支持

### Changed
- Agent 工作流目录迁移：将 `.clinerules/workflows` 移动到 `.agents/workflows`，统一 agent 配置与工作流入口
- 任务 UI 状态恢复机制增强：引入 snapshot-first TaskUiState、ActionButtons 判决与消息窗口滚动/合并优化
- Prompt 变体配置简化：合并 Native GPT-5 系列变体，减少重复 prompt 文件
- Provider 配置与 token 语义进一步统一：修正 profile 展示、模型元数据、cache token 与 prompt cache 处理

### Fixed
- 修复多窗口任务 Profile 隔离、上下文压缩边界与 task-level overflow 状态恢复问题
- 修复工具审批与 Resume 流程：覆盖 read/list 审批、拒绝审批、恢复后原 ask 复用和 Process Anyway 输入传递
- 修复 `attempt_completion` 偶发不停止、带 feedback 恢复时错误显示 Start New Task 的状态流转问题
- 修复 auto-retry 取消无效、重试耗尽后不显示 Retry，以及空 API conversation 造成空响应循环的问题
- 修复 Apply Patch partial message 时间戳、短 diff 标记搜索和 MCP base URL 等稳定性问题

## [0.9.0]

### Added
- Profile 多配置系统：支持多组 API 密钥和端点配置，可独立管理不同环境的连接参数
- 多窗口/多实例支持：多个独立 Controller 实例，支持同时打开多个不相关的会话
- `find_references` 工具：通过 IDE LSP 查找所有符号引用
- `rename` 工具：语义级符号重命名（LSP 驱动，区分引用/注释/字符串）
- `replace_text` 工具：跨文件批量文本替换（literal 或 regex 模式）
- `qna_respond` 工具：问答交互模式，不执行任何变更
- UsageBar 使用量实时显示：token 消耗和费用实时展示
- I18n 多语言提示词框架：所有系统提示词迁移至国际化系统
- GLM 原生工具调用支持 (Native Tool Call)
- Cline → Dline 自动迁移：首次启动自动迁移所有数据

### Changed
- Focus Chain 升级顺序约束能力：强制 AI 按步骤顺序执行任务，禁止跳过或回填
- Skills 增强：slash 命令解析时自动加载关联 skill 到上下文
- Provider 模型配置独立为 JSON 文件（从 api.ts 分离），用户可直接编辑修改模型信息
- Task 状态机重构：解耦为 MessageChannel + BlockPhaseMachine + TaskPhaseMachine
- apiKey 安全存储与 Profile 配置分离：apiKey 独立存储到专用 key store
- Checkpoint 轻量化：git diff --name-only 替代全量 git add .，大幅缩短持锁时间
- ClineMessage 增量推送：fetchMessage RPC + virtual-scroll 滑动窗口
- 启动性能大幅优化

### Fixed
- 根治 webview 灰屏：长对话上下文下 webview 偶发空白崩溃
- Command 终端中文乱码：自动检测 Windows 终端编码 (GBK/CP936 → UTF-8)
- Diff 工具多项修复：分隔符误判、孤儿标记误报、流式 UNCLOSED 误报等
- 任务恢复流程稳定化：JSONL 增量存储、消息精确匹配
