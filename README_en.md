# Dline — A More Stable Community Fork of Cline

> A community fork of [Cline](https://github.com/cline/cline), battle-tested in production, focused on stability, architecture upgrades, and practical enhancements.

## Key Improvements Over Cline

### Architecture Upgrades
- **Profile multi-configuration** — manage multiple API key/endpoint profiles independently
- **apiKey secure storage separation** — apiKey stored in dedicated key store, decoupled from Profile config
- **Task state machine refactored** — decoupled into MessageChannel + BlockPhaseMachine + TaskPhaseMachine
- **Provider model configs as JSON** — extracted from api.ts to standalone JSON files, user-editable
- **Cline → Dline auto-migration** — one-click migration on first launch, non-destructive with rollback support

### New Features
- **Multi-window/multi-instance** — independent Controller sessions running concurrently
- **Code refactoring tools** — `find_references` / `rename` / `replace_text`: LSP symbol search, semantic rename, cross-file batch replace
- **Q&A mode** — `qna_respond` tool for pure interaction without file modifications
- **I18n multi-language prompts** — all system prompts migrated to i18n framework
- **UsageBar real-time display** — token consumption and cost tracking
- **GLM native tool call** — Native Tool Call support for GLM models

### Stability
- **Webview gray screen fixed** — eliminated blank page crash under long conversation context
- **Terminal Chinese garbled text** — auto-detect Windows encoding (GBK/CP936 → UTF-8)
- **Diff tool fixes** — delimiter mismatch, orphan markers, streaming false alarms
- **Task resume stabilization** — JSONL incremental storage, precise message matching

### Enhancements
- **Focus Chain sequential constraint** — enforces step-by-step execution, prevents skipping
- **Skills enhancement** — auto-loads associated skills on slash command parsing
- **Checkpoint lightweight** — git diff --name-only replaces full git add
- **Message incremental push** — fetchMessage RPC + virtual-scroll for smooth scrolling
- **Startup performance** — significantly faster startup time

## License

[Apache 2.0](LICENSE)
