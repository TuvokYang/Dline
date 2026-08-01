import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, it } from "vitest"
import { buildPreloadedCommand, ShellEnvironmentConfigLoader } from "../shell-environment"

const temporaryDirectories: string[] = []

async function createWorkspace(config: string): Promise<string> {
	const workspace = await mkdtemp(path.join(os.tmpdir(), "dline-shell-environment-"))
	temporaryDirectories.push(workspace)
	await mkdir(path.join(workspace, ".agents"), { recursive: true })
	await writeFile(path.join(workspace, ".agents", "bashrc.yml"), config, "utf8")
	return workspace
}

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("ShellEnvironmentConfigLoader", () => {
	it("loads only the owning workspace and merges common, platform, and profile settings", async () => {
		const workspace = await createWorkspace(`
version: 1
environment:
  SHARED_VALUE: common
  EXPANDED_PATH: '\${env:BASE_PATH};common'
platforms:
  win32:
    environment:
      SHARED_VALUE: windows
      WINDOWS_ONLY: enabled
    profiles:
      powershell-legacy:
        environment:
          SHARED_VALUE: profile
        commands:
          - conda activate dline
          - Write-Output initialized
`)
		const loader = new ShellEnvironmentConfigLoader({
			workspaceRoots: [workspace],
			platform: "win32",
			environment: { BASE_PATH: "C:\\base" },
		})

		const resolved = await loader.resolve(path.join(workspace, "src"), "powershell-legacy")

		assert.ok(resolved)
		assert.equal(resolved.configPath, path.join(workspace, ".agents", "bashrc.yml"))
		assert.deepEqual(resolved.environment, {
			EXPANDED_PATH: "C:\\base;common",
			SHARED_VALUE: "profile",
			WINDOWS_ONLY: "enabled",
		})
		assert.deepEqual(resolved.initializationCommands, ["conda activate dline", "Write-Output initialized"])
		assert.ok(resolved.configurationId.length > 0)
	})

	it("does not load a project configuration for an external workdirectory", async () => {
		const workspace = await createWorkspace("version: 1\nenvironment:\n  SHOULD_NOT_LOAD: yes\n")
		const external = await mkdtemp(path.join(os.tmpdir(), "dline-shell-external-"))
		temporaryDirectories.push(external)
		const loader = new ShellEnvironmentConfigLoader({ workspaceRoots: [workspace], platform: "win32" })

		assert.equal(await loader.resolve(external, "powershell-legacy"), undefined)
	})

	it("rejects unsupported configuration fields instead of silently ignoring them", async () => {
		const workspace = await createWorkspace("version: 1\nunknown: value\n")
		const loader = new ShellEnvironmentConfigLoader({ workspaceRoots: [workspace], platform: "linux" })

		await assert.rejects(loader.resolve(workspace, "default"), /unknown/)
	})

	it("uses the latest project configuration on the next command", async () => {
		const workspace = await createWorkspace("version: 1\nenvironment:\n  CONFIG_VERSION: first\n")
		const configPath = path.join(workspace, ".agents", "bashrc.yml")
		const loader = new ShellEnvironmentConfigLoader({ workspaceRoots: [workspace], platform: "linux" })
		const first = await loader.resolve(workspace, "default")

		await writeFile(configPath, "version: 1\nenvironment:\n  CONFIG_VERSION: second\n", "utf8")
		const second = await loader.resolve(workspace, "default")

		assert.equal(first?.environment.CONFIG_VERSION, "first")
		assert.equal(second?.environment.CONFIG_VERSION, "second")
		assert.notEqual(first?.configurationId, second?.configurationId)
	})
})

describe("buildPreloadedCommand", () => {
	it("guards each Windows PowerShell initialization command before the requested command", () => {
		assert.equal(
			buildPreloadedCommand("npm test", ["conda activate dline", "Write-Output ready"], "powershell-legacy", "win32"),
			"& { conda activate dline; if (-not $?) { exit 1 }; Write-Output ready; if (-not $?) { exit 1 }; npm test }",
		)
	})

	it("chains Command Prompt and POSIX initialization in the current shell", () => {
		assert.equal(
			buildPreloadedCommand("cmake --build .", ['call "C:\\VS\\vcvars64.bat"'], "cmd", "win32"),
			'(call "C:\\VS\\vcvars64.bat") && (cmake --build .)',
		)
		assert.equal(
			buildPreloadedCommand(
				"npm test",
				["source /opt/conda/etc/profile.d/conda.sh", "conda activate dline"],
				"bash",
				"linux",
			),
			"source /opt/conda/etc/profile.d/conda.sh && conda activate dline && npm test",
		)
	})
})
