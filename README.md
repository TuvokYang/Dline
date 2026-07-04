# Dline — 更稳定的 Cline 社区改进版

> 基于 [Cline](https://github.com/cline/cline) 的社区分支，在生产环境中使用，专注于稳定性、架构升级与实用功能增强。

## 相比 Cline 的主要改进

### 架构升级
- **Profile 多配置系统** — 多组 API 密钥/端点独立管理，轻松切换不同环境
- **apiKey 安全存储分离** — apiKey 独立存储到专用 key store，与 Profile 配置解耦
- **Task 状态机重构** — 解耦为 MessageChannel + BlockPhaseMachine + TaskPhaseMachine，任务处理更稳定
- **Provider 模型配置 JSON 化** — 从 api.ts 分离为独立 JSON 文件，用户可直接编辑模型信息
- **Cline → Dline 一键迁移** — 首次启动自动迁移全部数据，非破坏性，可随时回滚

### 新功能
- **多窗口/多实例** — 多个独立 Controller 实例，同时打开多个不相关的会话
- **代码重构工具** — `find_references` / `rename` / `replace_text`，覆盖 LSP 引用查找、语义重命名、跨文件批量替换
- **问答模式** — `qna_respond` 工具，纯交互不修改任何文件
- **I18n 多语言提示词** — 全部系统提示词迁移至国际化框架
- **UsageBar 使用量显示** — token 消耗和费用实时展示
- **GLM 原生工具调用** — 支持 GLM 模型的 Native Tool Call

### 稳定性
- **根治 webview 灰屏** — 彻底解决长对话上下文下 webview 偶发空白崩溃
- **Command 中文乱码修复** — 自动检测 Windows 终端编码 (GBK/CP936 → UTF-8)
- **Diff 工具多项修复** — 分隔符误判、孤儿标记误报、流式 UNCLOSED 误报等
- **任务恢复稳定化** — JSONL 增量存储、消息精确匹配

### 增强
- **Focus Chain 顺序约束** — 强制 AI 按步骤顺序执行任务，禁止跳过或回填
- **Skills 增强** — slash 命令解析时自动加载关联 skill 到上下文
- **Checkpoint 轻量化** — git diff --name-only 替代全量 git add，大幅缩短持锁时间
- **消息增量推送** — fetchMessage RPC + virtual-scroll，流畅滚动不卡顿
- **启动性能优化** — 启动速度大幅提升

## License

[Apache 2.0](LICENSE)
