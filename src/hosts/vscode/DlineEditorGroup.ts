import * as vscode from "vscode"
import { Logger } from "@/shared/services/Logger"

const LOCK_EDITOR_GROUP_COMMAND = "workbench.action.lockEditorGroup"

type LockEditorGroup = () => PromiseLike<unknown>

/** Keeps Dline task panels in one editor group without taking editor focus. */
export class DlineEditorGroup {
	private readonly panels = new Set<vscode.WebviewPanel>()
	private targetColumn: vscode.ViewColumn | undefined
	private lockRequested = false

	constructor(
		private readonly lockEditorGroup: LockEditorGroup = () => vscode.commands.executeCommand(LOCK_EDITOR_GROUP_COMMAND),
	) {}

	getCreateViewColumn(): vscode.ViewColumn {
		return this.targetColumn ?? vscode.ViewColumn.Beside
	}

	register(panel: vscode.WebviewPanel): void {
		this.panels.add(panel)
		this.synchronize(panel)
	}

	synchronize(panel: vscode.WebviewPanel): void {
		if (!this.panels.has(panel) || !this.isConcreteColumn(panel.viewColumn)) return

		if (this.targetColumn === undefined) {
			this.targetColumn = panel.viewColumn
			this.requestLock(panel)
			return
		}

		if (panel.viewColumn !== this.targetColumn) {
			panel.reveal(this.targetColumn, true)
		}
		this.requestLock(panel)
	}

	unregister(panel: vscode.WebviewPanel): void {
		this.panels.delete(panel)
		if (this.panels.size === 0) {
			this.targetColumn = undefined
			this.lockRequested = false
		}
	}

	private requestLock(panel: vscode.WebviewPanel): void {
		if (this.lockRequested || !panel.active || panel.viewColumn !== this.targetColumn) return

		this.lockRequested = true
		void Promise.resolve(this.lockEditorGroup()).catch((error) => {
			this.lockRequested = false
			Logger.warn("[DlineEditorGroup] Failed to lock Dline editor group:", error)
		})
	}

	private isConcreteColumn(column: vscode.ViewColumn | undefined): column is vscode.ViewColumn {
		return typeof column === "number" && column >= vscode.ViewColumn.One
	}
}

export const dlineEditorGroup = new DlineEditorGroup()
