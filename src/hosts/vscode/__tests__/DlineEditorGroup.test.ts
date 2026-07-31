import { describe, expect, it, vi } from "vitest"
import type { WebviewPanel } from "vscode"
import { ViewColumn } from "vscode"
import { DlineEditorGroup } from "../DlineEditorGroup"

function createPanel(viewColumn: ViewColumn | undefined, active = true) {
	return {
		active,
		viewColumn,
		reveal: vi.fn(),
	} as unknown as WebviewPanel
}

describe("DlineEditorGroup", () => {
	it("opens the first panel beside and later panels in its resolved column", () => {
		const group = new DlineEditorGroup()

		expect(group.getCreateViewColumn()).toBe(ViewColumn.Beside)
		group.register(createPanel(ViewColumn.Two))

		expect(group.getCreateViewColumn()).toBe(ViewColumn.Two)
	})

	it("moves a restored panel into the existing Dline column without taking focus", () => {
		const group = new DlineEditorGroup()
		const existingPanel = createPanel(ViewColumn.Two)
		const restoredPanel = createPanel(ViewColumn.Three)
		group.register(existingPanel)

		group.register(restoredPanel)

		expect(restoredPanel.reveal).toHaveBeenCalledOnce()
		expect(restoredPanel.reveal).toHaveBeenCalledWith(ViewColumn.Two, true)
	})

	it("aligns a panel after VS Code resolves its concrete view column", () => {
		const group = new DlineEditorGroup()
		const existingPanel = createPanel(ViewColumn.Two)
		const pendingPanel = createPanel(undefined)
		group.register(existingPanel)
		group.register(pendingPanel)

		Object.defineProperty(pendingPanel, "viewColumn", { configurable: true, value: ViewColumn.Three })
		group.synchronize(pendingPanel)

		expect(pendingPanel.reveal).toHaveBeenCalledWith(ViewColumn.Two, true)
	})

	it("clears the target column after the last panel is removed", () => {
		const group = new DlineEditorGroup()
		const panel = createPanel(ViewColumn.Two)
		group.register(panel)

		group.unregister(panel)

		expect(group.getCreateViewColumn()).toBe(ViewColumn.Beside)
	})

	it("locks the first active Dline panel group exactly once", () => {
		const lockEditorGroup = vi.fn(() => Promise.resolve())
		const group = new DlineEditorGroup(lockEditorGroup)
		const firstPanel = createPanel(ViewColumn.Two)

		group.register(firstPanel)
		group.synchronize(firstPanel)
		group.register(createPanel(ViewColumn.Two))

		expect(lockEditorGroup).toHaveBeenCalledOnce()
	})
})
