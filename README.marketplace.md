# Dline

Dline is a VS Code extension for agentic software development. It helps you plan changes, edit files, inspect project context, run commands in the VS Code terminal with approval, and review results without leaving your editor.

Dline is a modified community fork of [Cline](https://github.com/cline/cline). It is not the official Cline release and is not published by Cline Bot Inc. The Cline name is used only to describe project origin and compatibility.

## What Dline Does

- **Chat with your workspace**: Ask Dline to inspect files, explain code, implement changes, fix bugs, or continue existing tasks from history.
- **Edit files with review**: Dline proposes file changes inside VS Code so you can inspect, approve, adjust, or reject them.
- **Run terminal commands safely**: Commands are executed through the VS Code terminal with user approval and visible output.
- **Work through long tasks**: Dline tracks task state, command output, checkpoints, history, and context across multi-step coding sessions.
- **Use multiple model providers**: Configure supported providers and compatible endpoints from the extension settings.
- **Recover and compare work**: Use checkpoints and task history to inspect previous progress and restore when needed.

## Dline Improvements

### Stability

- Improved webview stability for long conversations and large task histories.
- Smoother handling of task history, recent tasks, and restored tasks.
- Reduced UI interruptions during streaming output and long-running sessions.

### VS Code Terminal Experience

- Better handling of Windows terminal output encoding, including GBK/CP936 to UTF-8 conversion.
- Clearer command status display for running, completed, failed, and interrupted commands.
- Terminal sessions are labeled as Dline and use the Dline product icon.

### Model and Provider Support

- Support for configurable API endpoints and model settings.
- Enhanced provider error handling for clearer failure messages.
- Improved support for reasoning/thinking-capable model configurations where available.

### UI and Workflow

- Task history and recent task views tailored for repeated VS Code workflows.
- Token, cache, and cost display improvements in task headers and history.
- ANSI color rendering for command output.
- Collapsed-by-default completed command and diff sections to keep long tasks readable.
- Floating scroll controls for navigating long conversations.

## Human-in-the-Loop by Design

Dline is built around review and approval. File edits, terminal commands, and important task decisions remain visible in VS Code so you can stay in control of what changes in your workspace.

## Relationship to Cline

Dline is based on the Apache-2.0 licensed Cline project and includes modifications focused on VS Code extension stability and practical workflow improvements. Original Cline copyright, license, and attribution notices are retained. Dline-specific changes are maintained by the Dline maintainers.

## License

Licensed under the [Apache License 2.0](./LICENSE).
