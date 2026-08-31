import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { HostProvider } from "@hosts/host-provider"
import { FileEditProvider } from "@integrations/editor/FileEditProvider"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { ClineDefaultTool } from "@shared/tools"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TaskState } from "../../../TaskState"
import { ToolValidator } from "../../ToolValidator"
import type { TaskConfig } from "../../types/TaskConfig"
import { WriteToFileToolHandler } from "../WriteToFileToolHandler"

const temporaryRoots: string[] = []

afterEach(async () => {
	vi.restoreAllMocks()
	await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("WriteToFileToolHandler external approval side effects", () => {
	it("creates a sibling external file before external-edit approval is requested", async () => {
		const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "dline-write-external-approval-"))
		temporaryRoots.push(temporaryRoot)
		const workspaceDir = path.join(temporaryRoot, "dline")
		const siblingDir = path.join(temporaryRoot, "u000workspace")
		const externalPath = path.join(siblingDir, "proof.txt")
		await fs.mkdir(workspaceDir)

		const workspace = HostProvider.workspace as typeof HostProvider.workspace & {
			getWorkspacePaths: ReturnType<typeof vi.fn>
			saveOpenDocumentIfDirty: ReturnType<typeof vi.fn>
			getDiagnostics: ReturnType<typeof vi.fn>
		}
		workspace.getWorkspacePaths = vi.fn(async () => ({ paths: [workspaceDir] }))
		workspace.saveOpenDocumentIfDirty = vi.fn(async () => ({}))
		workspace.getDiagnostics = vi.fn(async () => ({ fileDiagnostics: [] }))

		const diffViewProvider = new FileEditProvider()
		const taskState = new TaskState()
		let observedBeforeApproval: { exists: boolean; content?: string } | undefined
		const shouldAutoApproveToolWithPath = vi.fn(async () => {
			try {
				observedBeforeApproval = {
					exists: true,
					content: await fs.readFile(externalPath, "utf8"),
				}
			} catch {
				observedBeforeApproval = { exists: false }
			}
			return false
		})
		const rejectActiveBlock = vi.fn()
		const config = {
			taskId: "task-external-write",
			ulid: "ulid-external-write",
			cwd: workspaceDir,
			mode: "act",
			strictPlanModeEnabled: false,
			yoloModeToggled: false,
			doubleCheckCompletionEnabled: false,
			vscodeTerminalExecutionMode: "backgroundExec",
			enableParallelToolCalling: false,
			isSubagentExecution: false,
			taskState,
			taskController: { rejectActiveBlock },
			messageState: { clineMessages: [] },
			api: {
				getModel: () => ({ id: "test-model", info: { capabilities: { contextWindow: 128_000 } } }),
			},
			services: {
				diffViewProvider,
				stateManager: {
					getApiConfiguration: () => ({}),
					getGlobalSettingsKey: (key: string) => (key === "hooksEnabled" ? false : undefined),
				},
				fileContextTracker: {
					markFileAsEditedByCline: vi.fn(),
					trackFileContext: vi.fn(async () => undefined),
				},
				taskFileTracker: { trackModification: vi.fn() },
				ignoreController: { validateAccess: () => true },
			},
			autoApprovalSettings: {
				...DEFAULT_AUTO_APPROVAL_SETTINGS,
				actions: {
					...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
					editFiles: true,
					editFilesExternally: false,
				},
			},
			interactions: {
				open: vi.fn(async () => ({ actionId: "reject" })),
			},
			callbacks: {
				ask: vi.fn(async () => ({ response: "yesButtonClicked" })),
				say: vi.fn(async () => undefined),
				shouldAutoApproveToolWithPath,
				setActiveHookExecution: vi.fn(async () => undefined),
				clearActiveHookExecution: vi.fn(async () => undefined),
				cancelTask: vi.fn(async () => undefined),
			},
			coordinator: {},
		} as unknown as TaskConfig
		const handler = new WriteToFileToolHandler(new ToolValidator({ validateAccess: () => true } as never))
		const block = {
			type: "tool_use" as const,
			name: ClineDefaultTool.FILE_NEW,
			params: { absolutePath: externalPath, content: "external risk proof" },
			partial: false,
			ts: 1,
			function_id: "call-external-write",
			dline_tid: "dline-tid-external-write",
		}

		const result = await handler.execute(config, block)

		expect(shouldAutoApproveToolWithPath).toHaveBeenCalledWith(ClineDefaultTool.FILE_NEW, externalPath)
		expect(observedBeforeApproval).toEqual({ exists: true, content: "" })
		expect(result).toContain("The user denied this operation")
		expect(rejectActiveBlock).toHaveBeenCalledOnce()
		await expect(fs.access(externalPath)).rejects.toMatchObject({ code: "ENOENT" })
	})
})
