import os from "node:os"
import path from "node:path"
import { getTaskArtifactDirectory } from "@core/artifacts/runtime"
import { HostProvider } from "@hosts/host-provider"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { ClineDefaultTool } from "@shared/tools"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AutoApprove } from "../autoApprove"

afterEach(() => vi.restoreAllMocks())

describe("AutoApprove task read scope", () => {
	it("uses Read project files for only the current task artifacts and tmp directories", async () => {
		const taskId = "task-read-scope"
		const workspaceDirectory = path.join(os.tmpdir(), "dline-project-read-scope")
		vi.spyOn(HostProvider.workspace, "getWorkspacePaths").mockResolvedValue({ paths: [workspaceDirectory] })
		const settings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				readFiles: true,
				readFilesExternally: false,
			},
		}
		const autoApprove = new AutoApprove(
			{
				getGlobalSettingsKey: (key: string) => {
					if (key === "yoloModeToggled" || key === "autoApproveAllToggled") return false
					if (key === "autoApprovalSettings") return settings
					return undefined
				},
				getGlobalStateKey: (key: string) => (key === "multiRootEnabled" ? false : undefined),
			} as never,
			taskId,
		)
		const taskDirectory = getTaskArtifactDirectory(taskId)
		const artifactPath = path.join(taskDirectory, "artifacts", "images", "generated.png")
		const previewPath = path.join(taskDirectory, "tmp", "image-previews", "preview")
		const taskHistoryPath = path.join(taskDirectory, "ui_messages.jsonl")
		const otherTaskArtifactPath = path.join(getTaskArtifactDirectory("another-task"), "artifacts", "images", "generated.png")

		expect(await autoApprove.shouldAutoApproveToolWithPath(ClineDefaultTool.FILE_READ, artifactPath)).toBe(true)
		expect(await autoApprove.shouldAutoApproveToolWithPath(ClineDefaultTool.FILE_READ, previewPath)).toBe(true)
		expect(await autoApprove.shouldAutoApproveToolWithPath(ClineDefaultTool.FILE_READ, taskHistoryPath)).toBe(false)
		expect(await autoApprove.shouldAutoApproveToolWithPath(ClineDefaultTool.FILE_READ, otherTaskArtifactPath)).toBe(false)
		expect(await autoApprove.shouldAutoApproveToolWithPath(ClineDefaultTool.LIST_FILES, artifactPath)).toBe(false)
	})
})
