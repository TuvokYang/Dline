中文 | [English](docs/changelog/CHANGELOG_en.md)

# Changelog

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
