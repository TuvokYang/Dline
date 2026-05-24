[中文版](README.md) | English

# Dline — A More Stable Community Fork of Cline

> A community fork of [Cline](https://github.com/cline/cline), focused on stability and practical enhancements for production use.

## Why Dline?

Cline is an excellent AI coding agent, but we encountered stability issues in daily production use — particularly with the VSCode webview going blank (gray screen) under long context. Dline is our effort to fix these issues and add practical features we needed.

## Key Improvements Over Cline

### Stability
- **Eliminated webview gray screen** — Completely resolved the occasional blank webview bug under long conversation context
- **Auto terminal encoding detection** — Automatically detects and converts Windows terminal output encoding (GBK/CP936 → UTF-8), fixing Chinese garbled text in command output
- **Command status color & indicators** — Added colored backgrounds for command execution status; fixed incorrect status indicator display
- **Fixed settings input bounce** — Resolved the character input bounce issue in settings fields

### Enhanced Model Support
- **DeepSeek V4 with thinking mode** — Full support for DeepSeek V4 models with reasoning/thinking mode toggle
- **Custom Anthropic API** — Supports custom API endpoints, model names, token limits, and thinking switches. Also compatible with [DeepSeek's Anthropic API](https://api-docs.deepseek.com/guides/anthropic_api)
- **Provider parse error handling** — Better error classification for provider-specific API errors

### UI Improvements
- **Ansi color rendering** — Command output now displays terminal-style colored text (ANSI escape sequences)
- **Default collapsed views** — Diff Edit and Command output rows are collapsed by default after completion
- **Floating scroll-to-bottom button** — Convenient navigation in long message history
- **Restored command color indicators** — Fixed match-failed detection and color display

### I18n Foundation
- Multi-language system prompt framework groundwork

## Known Issues
- **Occasional scroll bounce** — A side effect of the gray screen fix; still being investigated

## Roadmap
- [ ] Token usage and cost display
- [ ] Multi-language prompts (Chinese, Japanese, etc.)
- [ ] Fix Anthropic provider subagent missing thinking mode

## License

[Apache 2.0](LICENSE)
