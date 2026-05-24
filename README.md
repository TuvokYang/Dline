[English](README_en.md) | 中文

# Dline — 更稳定的 Cline 社区改进版

> 基于 [Cline](https://github.com/cline/cline) 的社区分支，已在生产环境中使用，专注于稳定性与实用功能增强。

## 为什么需要 Dline？

Cline 是一个优秀的 AI 编码助手，但在日常生产中我们遇到了稳定性问题——尤其是 VSCode webview 在长上下文下偶发灰屏。Dline 是我们的修复与增强版本。

## 相比 Cline 的主要改进

### 稳定性
- **根治 webview 灰屏** — 彻底解决长对话上下文下 webview 偶发空白灰屏的 bug
- **自动终端编码检测** — 自动检测 Windows 终端输出编码（GBK/CP936 → UTF-8），消除命令行中文乱码
- **Command 状态颜色与指示** — 为命令执行状态添加不同颜色背景，修复状态指示器错误
- **修复设置输入弹跳** — 解决设置页面字符输入弹跳问题

### 模型支持增强
- **DeepSeek V4 思考模式** — 完整支持 DeepSeek V4 模型，可切换 reasoning/thinking 模式
- **自定义 Anthropic API** — 支持自定义 API 端点、模型名称、token 限制、thinking 开关。同时兼容 [DeepSeek 的 Anthropic API](https://api-docs.deepseek.com/zh-cn/guides/anthropic_api)
- **Provider 解析错误处理** — 更精准的 API 错误分类

### UI 优化
- **ANSI 颜色渲染** — 命令行输出支持终端风格的 ANSI 彩色显示
- **默认折叠** — Diff Edit 和 Command 命令行完成后自动折叠
- **浮动回底按钮** — 长历史记录中快速滚动到底部
- **恢复命令颜色指示器** — 修复 match-failed 检测和颜色显示逻辑

### I18n 基础
- 多语言系统提示词框架基础

## 已知问题
- **滚动偶发弹跳** — 灰屏修复的已知副作用，仍在排查中

## 下一步计划
- [ ] 使用量和金额显示
- [ ] 多语言提示词（中文、日文等）
- [ ] 修复 Anthropic provider subagent 未携带 thinking 的问题

## License

[Apache 2.0](LICENSE)
