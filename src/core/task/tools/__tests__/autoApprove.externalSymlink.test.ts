import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { HostProvider } from "@hosts/host-provider"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { ClineDefaultTool } from "@shared/tools"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AutoApprove } from "../autoApprove"

const temporaryRoots: string[] = []

afterEach(async () => {
	vi.restoreAllMocks()
	await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("AutoApprove canonical workspace boundary characterization", () => {
	it("auto-approves a workspace junction whose real target is a sibling external directory", async () => {
		const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dline-autoapprove-junction-"))
		temporaryRoots.push(temporaryRoot)
		const workspaceDir = path.join(temporaryRoot, "dline")
		const externalDir = path.join(temporaryRoot, "u000workspace")
		const linkedDir = path.join(workspaceDir, "linked-outside")
		await fs.mkdir(workspaceDir)
		await fs.mkdir(externalDir)
		await fs.symlink(externalDir, linkedDir, process.platform === "win32" ? "junction" : "dir")

		const workspace = HostProvider.workspace as typeof HostProvider.workspace & {
			getWorkspacePaths: ReturnType<typeof vi.fn>
		}
		workspace.getWorkspacePaths = vi.fn(async () => ({ paths: [workspaceDir] }))
		const settings = {
			...DEFAULT_AUTO_APPROVAL_SETTINGS,
			actions: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
				editFiles: true,
				editFilesExternally: false,
			},
		}
		const autoApprove = new AutoApprove({
			getGlobalSettingsKey: (key: string) => {
				if (key === "yoloModeToggled" || key === "autoApproveAllToggled") return false
				if (key === "autoApprovalSettings") return settings
				return undefined
			},
			getGlobalStateKey: (key: string) => (key === "multiRootEnabled" ? false : undefined),
		} as never)
		const linkedFile = path.join(linkedDir, "proof.txt")
		const canonicalParent = await fs.realpath(path.dirname(linkedFile))
		const canonicalRelative = path.relative(workspaceDir, canonicalParent)

		expect(canonicalRelative === ".." || canonicalRelative.startsWith(`..${path.sep}`)).toBe(true)
		expect(await autoApprove.shouldAutoApproveToolWithPath(ClineDefaultTool.FILE_NEW, linkedFile)).toBe(true)
	})
})
