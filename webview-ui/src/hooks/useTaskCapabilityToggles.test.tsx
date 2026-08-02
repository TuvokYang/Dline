import { createTaskCapabilityToggles, parseTaskCapabilityToggles } from "@shared/TaskCapabilityToggles"
import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
	state: {} as Record<string, unknown>,
	updateTaskSettings: vi.fn(),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => mocks.state,
}))

vi.mock("@/components/settings/utils/settingsHandlers", () => ({
	updateTaskSettings: mocks.updateTaskSettings,
}))

import { useTaskCapabilityToggles } from "./useTaskCapabilityToggles"

const baseState = () => ({
	currentTaskItem: undefined,
	taskViewState: undefined,
	taskCapabilityToggles: undefined,
	setTaskCapabilityToggles: vi.fn(),
	globalClineRulesToggles: {},
	localClineRulesToggles: {},
	localCursorRulesToggles: {},
	localWindsurfRulesToggles: {},
	localAgentsRulesToggles: {},
	globalWorkflowToggles: {},
	localWorkflowToggles: {},
	globalSkillsToggles: { "global-skill.md": false },
	localSkillsToggles: {},
	remoteSkillsToggles: {},
	remoteRulesToggles: {},
	remoteWorkflowToggles: {},
	mcpServers: [],
})

describe("useTaskCapabilityToggles", () => {
	beforeEach(() => {
		mocks.state = baseState()
		mocks.updateTaskSettings.mockReset().mockResolvedValue(undefined)
	})

	it("keeps an empty Welcome screen in global scope", () => {
		const { result } = renderHook(() => useTaskCapabilityToggles())

		expect(result.current.isTaskScoped).toBe(false)
		expect(result.current.snapshot).toBeUndefined()
	})

	it("does not create task-scoped state before a task exists", async () => {
		const { result } = renderHook(() => useTaskCapabilityToggles())

		await act(() => result.current.updateToggle("globalSkillsToggles", "global-skill.md", true))

		expect(result.current.isTaskScoped).toBe(false)
		expect(mocks.state.setTaskCapabilityToggles).not.toHaveBeenCalled()
		expect(mocks.updateTaskSettings).not.toHaveBeenCalled()
	})

	it("persists active-task changes through task settings", async () => {
		mocks.state = {
			...baseState(),
			taskViewState: { taskId: "task-1" },
			taskCapabilityToggles: createTaskCapabilityToggles({ mcpServers: { docs: true } }),
		}
		const { result } = renderHook(() => useTaskCapabilityToggles())

		await act(() => result.current.updateToggle("mcpServers", "docs", false))

		expect(mocks.updateTaskSettings).toHaveBeenCalledOnce()
		const [taskId, settings] = mocks.updateTaskSettings.mock.calls[0]
		expect(taskId).toBe("task-1")
		expect(parseTaskCapabilityToggles(settings.taskCapabilityToggles)?.mcpServers).toEqual({ docs: false })
	})

	it("reconciles discoveries without overwriting an existing task choice", async () => {
		mocks.state = {
			...baseState(),
			taskViewState: { taskId: "task-1" },
			taskCapabilityToggles: createTaskCapabilityToggles({
				localWorkflowToggles: { kept: false, stale: true },
			}),
		}
		const { result } = renderHook(() => useTaskCapabilityToggles())

		await act(() => result.current.reconcile({ localWorkflowToggles: { kept: true, added: true } }))

		const settings = mocks.updateTaskSettings.mock.calls[0][1]
		expect(parseTaskCapabilityToggles(settings.taskCapabilityToggles)?.localWorkflowToggles).toEqual({
			kept: false,
			added: true,
		})
	})
})
