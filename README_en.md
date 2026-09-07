<div align="center">

# Dline

**An autonomous coding agent inside your IDE**

Read and write files, run commands, drive a browser, and call MCP tools — with your approval at every step.

[中文](README.md) | English · [Changelog](docs/changelog/CHANGELOG_en.md)

</div>

---

## Overview

Dline is a community fork of [Cline](https://github.com/cline/cline) that runs daily in real production projects.

While keeping the original interaction model, Dline has substantially rewritten the task runtime, state storage, prompt architecture, context management, and terminal execution — over 2,300 source files changed and 300k lines added. The through-line of that work is **task isolation**: a single workspace can run multiple independent tasks at once, each with its own profile, capability configuration, checkpoint boundary, and execution state.

Typical scenarios:

- Running several tasks in one workspace, each with its own model and configuration
- Binding a lightweight model to research and a stronger one to implementation, per task rather than globally
- Enabling skills, workflows, and MCP servers per project and per task instead of through one global switch
- Working on long tasks that overflow the context window, relying on multi-pass compaction to keep going
- Keeping the UI and terminals responsive during long conversations and frequent command execution

## Install

Build a VSIX from source and install it:

```bash
npm run install:all
npm run vsix
```

Load the generated `.vsix` through VS Code's "Install from VSIX" command, or run:

```bash
code --install-extension <generated-vsix-file>
```

Requires VS Code 1.134.0 or newer. Existing Cline data is migrated automatically on first launch, without destroying the original files.

## Core Capabilities

### Task isolation and parallel execution

A single workspace runs multiple tasks concurrently, fully isolated from each other:

- **Independent profiles** — each task binds its own model and endpoint, so a research task can run a lightweight model while an implementation task runs a stronger one
- **Independent capabilities** — skills, workflows, MCP, and browser access toggle per task and persist with it
- **Independent checkpoint boundaries** — file ownership is arbitrated per task and checkpoint locks are separated, so one task's rollback never touches files another task changed
- **Independent execution state** — cancellation, resume, and approval each form their own chain without cross-talk

### Resource limits under concurrency

Parallel tasks share one machine, so code search and state persistence run under explicit budgets:

- **Search CPU budget** — a single task's ripgrep processes use at most 30% of the machine's logical threads, and all tasks together at most 50%, so one repository-wide search cannot saturate the CPU
- **Debounced batch persistence** — state changes land in an in-memory cache first and are written in batches, keeping frequent updates off the interaction path
- **Non-blocking history writes** — history metadata returns as soon as the write is queued; the transaction settles in the background without the UI waiting on disk
- **Incremental appends** — conversation messages append incrementally instead of re-serializing the entire history on every write
- **Separated checkpoint locks** — checkpoints hold per-task locks, so one task's save never blocks another

### Three-scope capability configuration

Rules, skills, workflows, MCP servers, and browser access resolve across **global / workspace / task** scopes, each layer overriding the one above:

| Scope | Use case |
|---|---|
| Global | Personal preferences shared across all projects |
| Workspace | Team conventions for the current project |
| Task | Temporarily enabled or disabled for this task only |

Task-level settings persist with the task and are restored on resume without polluting workspace configuration.

### Iterative automatic compaction

When context approaches or exceeds the window, compaction advances in multiple passes: each pass plans a conversation range that is safe to compact, produces a cumulative summary, and carries it into the next pass — repeating until the remaining context is small enough for the task to continue.

A task too large for a single pass does not simply stop. Compaction runs under budget constraints with retry replay, so a mid-way failure recovers and resumes instead of forcing a restart.

### Multiple configuration profiles

Manage several API keys and endpoints at once, and bind them per task, per subagent, or for image generation. API keys live in a dedicated key store, decoupled from profile configuration, so switching a profile never disturbs other running tasks.

Supports 30+ providers including OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, AWS Bedrock, Qwen, and GLM. When a model supports several protocols you can choose between OpenAI Chat, OpenAI Responses, and Anthropic Chat formats.

### Web search and fetch with automatic routing

`web_search` and `web_fetch` route automatically based on the current model's capabilities: hosted execution when the provider offers it, falling back to the local implementation otherwise — no manual switching required.

Per-profile overrides are available: auto, force local, force remote, or off.

### Image generation

`generate_image` supports three sources: reuse the current OpenAI profile, use the provider's hosted image capability, or bind a standalone OpenAI / Gemini image profile. Count, size, quality, format, and background are configurable, and existing images can be used as references for further editing.

### Incremental message rendering

Messages stream through incremental push and a virtual scrolling window that renders only what is in view. Scrolling and typing stay responsive as the conversation grows, instead of degrading with history size.

### Warm terminal pool

Terminals are pre-warmed per configuration partition, so a command takes an already-initialized terminal instead of waiting for shell startup and integration handshake. Terminals are reusable, reclaimed on demand, and fall back to cold creation on failure.

### Live activity panel

Work and Activities tabs make the agent's execution fully observable: the tool currently running, subagent call timelines and metrics, API rate and context usage charts, and the complete retry sequence for failures.

### Subagents and task orchestration

- `use_subagent` / `use_subagents` — delegate isolated read-only research with background execution, timeouts, and automatic retry of recoverable failures; up to 5 in parallel
- `spawn_task` — spawn an independent peer task that starts in Plan or Act mode
- `load_skill` / `load_workflow` / `load_mcp` — load skills, workflows, and MCP tools on demand instead of paying for them upfront in context

### Code understanding and editing

Beyond the usual read, write, search, and command tools, Dline provides LSP-backed semantic operations: `find_references` locates every reference to a symbol, `rename` performs a semantic rename, and `replace_text` applies cross-file batch replacements.

### Terminal and command control

Commands take a `workdirectory` parameter instead of a prepended `cd`, execution timeout and background handoff duration are configurable, and long-running commands move to the background while preserving their output. `kill_command` terminates a specific command. On Windows, PowerShell selection and UTF-8 encoding are handled automatically.

### Fine-grained permissions

`.agentignore` grants access per dimension rather than hiding paths outright:

```gitignore
secrets/          # remove every permission
vendor/ -w        # read-only, writes rejected
generated/ -s     # hidden from listings and search, still readable by exact path
scripts/ext/ -x   # cannot be used as a command working directory
```

Capability toggles resolve across global, workspace, and task scopes, and task-level settings persist with the task.

### Session storage

Task history is stored in SQLite, avoiding full scans. You can keep typing while a task runs — messages queue and arrive at a safe boundary. Git-based checkpoints let you roll back file changes at any time.

### Rich rendering

` ```latex ` code blocks in the conversation are typeset by MathJax v4, and ` ```mermaid ` blocks render as diagrams that can be exported to SVG.

### Optional runtime diagnostics

When something goes wrong, enable runtime telemetry sampling in settings and export a diagnostic bundle in one click. The resulting ZIP contains no code, prompts, or credentials. This feature is off by default.

## Configuration Directories

| Path | Purpose |
|---|---|
| `.agents/rules/` | Project rules |
| `.agents/workflows/` | Reusable multi-step procedures |
| `.agents/skills/` | Task-specific methods and best practices |
| `.agents/subagents/` | Subagent definitions (YAML) |
| `.agentignore` | Agent access permission rules |
| `.dline/mcp/` | MCP server configuration |

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development notes.

## License

[Apache 2.0](LICENSE)
