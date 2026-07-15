import os from "node:os"
import { getShell } from "@utils/shell"
import { getPrompt } from "../../i18n"
import type { PromptEnv } from "../../template/types"
import type { SystemPromptContext } from "../context"

const TEST_HOME = "/Users/tester"
const TEST_SHELL = "/bin/zsh"

/** Builds deterministic system environment values for prompt generation. */
export function buildSystemEnv(context: SystemPromptContext): PromptEnv {
	const cwd = context.cwd ?? process.cwd()
	const roots = context.workspaceRoots?.length ? context.workspaceRoots : [{ name: "primary", path: cwd }]

	return {
		CWD: cwd,
		HOME_DIR: context.isTesting ? TEST_HOME : os.homedir(),
		SHELL: context.isTesting ? TEST_SHELL : resolveShell(context),
		COMMAND_ENV: context.terminalExecutionMode ?? "vscodeTerminal",
		WORKSPACE_ROOTS: formatRoots(roots),
		MULTI_ROOT_HINT:
			context.isMultiRootEnabled && roots.length > 1 ? getPrompt("runtimeEnvironment", "workspaceReferenceHint") : "",
		IDE_NAME: context.ide,
	}
}

/** Resolves the shell used by the configured command environment. */
function resolveShell(context: SystemPromptContext): string {
	if (context.terminalExecutionMode !== "backgroundExec") {
		return getShell()
	}
	return process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : process.env.SHELL || "/bin/bash"
}

/** Formats workspace roots into a stable prompt-safe string. */
function formatRoots(roots: readonly { readonly path: string; readonly name: string; readonly vcs?: string }[]): string {
	return roots.map((root) => `${root.name}: ${root.path}${root.vcs ? ` (${root.vcs})` : ""}`).join("; ")
}
