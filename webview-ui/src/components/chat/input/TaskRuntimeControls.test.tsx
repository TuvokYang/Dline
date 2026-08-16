import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { TaskRuntimeControls } from "./TaskRuntimeControls"

const mocks = vi.hoisted(() => ({
	state: {
		apiConfiguration: {
			actModeProfileId: "openai-id",
			actModeProfile: "old-name",
		},
		currentTaskItem: { id: "task-1" },
		taskTitleMessage: { ts: 1, type: "say" as const, say: "task" as const, text: "Task" },
		mode: "act" as const,
		modeSwitch: { phase: "idle" as const },
		profileSwitch: { phase: "idle" as const },
		taskViewState: { taskId: "task-1", phase: "between_turns" as const },
	},
	profiles: [
		{
			id: "openai-id",
			name: "renamed-openai",
			provider: "openai",
			modelId: "gpt-test",
			usedFor: [],
			enabled: true,
			openai: {
				reasoning: { enableThinking: true, effort: "high", thinkingBudget: 0 },
				serviceTier: "priority",
			},
			modelInfo: {
				capabilities: {
					supportsReasoning: true,
					thinking: {
						effortLevels: ["none", "low", "medium", "high"],
						maxBudget: 8_192,
					},
				},
			},
		},
	],
	updateTaskSettings: vi.fn(),
}))

vi.mock("@context/ExtensionStateContext", () => ({
	useExtensionState: () => mocks.state,
}))

vi.mock("@components/settings/providers/useApiProfiles", () => ({
	useApiProfiles: () => ({ profiles: mocks.profiles }),
}))

vi.mock("@components/settings/utils/settingsHandlers", () => ({
	updateTaskSettings: mocks.updateTaskSettings,
}))

beforeAll(() => {
	Object.defineProperties(HTMLElement.prototype, {
		hasPointerCapture: { configurable: true, value: () => false },
		releasePointerCapture: { configurable: true, value: () => undefined },
		scrollIntoView: { configurable: true, value: () => undefined },
		setPointerCapture: { configurable: true, value: () => undefined },
	})
})

describe("chat input TaskRuntimeControls", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.state.apiConfiguration = {
			actModeProfileId: "openai-id",
			actModeProfile: "old-name",
		}
		mocks.state.currentTaskItem = { id: "task-1" }
		mocks.state.taskTitleMessage = { ts: 1, type: "say", say: "task", text: "Task" }
		mocks.state.mode = "act"
		mocks.state.modeSwitch = { phase: "idle" }
		mocks.state.profileSwitch = { phase: "idle" }
		mocks.state.taskViewState = { taskId: "task-1", phase: "between_turns" }
		mocks.profiles = [
			{
				id: "openai-id",
				name: "renamed-openai",
				provider: "openai",
				modelId: "gpt-test",
				usedFor: [],
				enabled: true,
				openai: {
					reasoning: { enableThinking: true, effort: "high", thinkingBudget: 0 },
					serviceTier: "priority",
				},
				modelInfo: {
					capabilities: {
						supportsReasoning: true,
						thinking: {
							effortLevels: ["none", "low", "medium", "high"],
							maxBudget: 8_192,
						},
					},
				},
			},
		]
		mocks.updateTaskSettings.mockResolvedValue(undefined)
	})

	it("hides Task-local controls when no Task is open even if stale Task state remains", () => {
		mocks.state.taskTitleMessage = undefined
		const { container } = render(<TaskRuntimeControls />)

		expect(container).toBeEmptyDOMElement()
		expect(screen.queryByRole("combobox", { name: "Task thinking override" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Task service tier" })).not.toBeInTheDocument()
	})

	it("renders frameless Thinking text and an icon-only Service Tier trigger", async () => {
		const user = userEvent.setup()
		const { container } = render(<TaskRuntimeControls />)
		const thinkingControl = screen.getByRole("combobox", { name: "Task thinking override" })
		const serviceTierControl = screen.getByRole("button", { name: "Task service tier" })

		expect(thinkingControl).toHaveTextContent("High")
		expect(thinkingControl).not.toHaveTextContent("Default")
		expect(thinkingControl).toHaveClass("border-0", "shadow-none", "p-0", "rounded-none")
		expect(thinkingControl.querySelector("svg")).toBeNull()
		expect(serviceTierControl).toBeInTheDocument()
		expect(serviceTierControl.textContent).toBe("")
		expect(serviceTierControl).toHaveAttribute("data-icon-only", "true")
		expect(serviceTierControl).toHaveAttribute("title", "Service tier: Priority")
		expect(serviceTierControl).toHaveClass("border-0", "shadow-none", "p-0")
		expect(screen.getByTestId("task-service-tier-icon")).toBeInTheDocument()
		expect(screen.queryByText("Tier")).not.toBeInTheDocument()
		expect(screen.queryByText("Thinking", { exact: true })).not.toBeInTheDocument()
		expect(container.querySelector('[data-chat-input-slot="thinking"]')).toHaveClass(
			"min-w-[3ch]",
			"max-w-[7ch]",
			"flex-[0_1_7ch]",
			"overflow-hidden",
		)
		expect(container.querySelector('[data-chat-input-slot="thinking"]')).not.toHaveClass("shrink-0")
		expect(container.querySelector('[data-chat-input-slot="service-tier"]')).toHaveClass("shrink-0")

		await user.click(serviceTierControl)
		expect(screen.getByRole("listbox", { name: "Task service tier options" })).toBeInTheDocument()
		expect(screen.queryByRole("option", { name: "Profile" })).not.toBeInTheDocument()
		for (const tier of ["Auto", "Default", "Flex", "Scale", "Priority"]) {
			expect(screen.getByRole("option", { name: tier })).toBeInTheDocument()
		}
		await user.click(serviceTierControl)

		await user.click(thinkingControl)
		expect(screen.getByRole("option", { name: "High" })).toBeInTheDocument()
		expect(screen.queryByRole("option", { name: "Profile" })).not.toBeInTheDocument()
		expect(document.querySelector('[data-slot="select-content"]')).toHaveClass("bg-menu")
	})

	it("commits an effort and service tier only to the active Task and mode", async () => {
		const user = userEvent.setup()
		render(<TaskRuntimeControls />)

		await user.click(screen.getByRole("combobox", { name: "Task thinking override" }))
		await user.click(screen.getByRole("option", { name: "Low" }))
		await waitFor(() => expect(mocks.updateTaskSettings).toHaveBeenCalledTimes(1))
		expect(screen.getByRole("combobox", { name: "Task thinking override" })).toHaveTextContent("Low")
		await waitFor(() => expect(screen.getByRole("button", { name: "Task service tier" })).not.toBeDisabled())
		await user.click(screen.getByRole("button", { name: "Task service tier" }))
		expect(screen.queryByRole("option", { name: "Profile" })).not.toBeInTheDocument()
		await user.click(screen.getByRole("option", { name: "Flex" }))

		await waitFor(() => expect(mocks.updateTaskSettings).toHaveBeenCalledTimes(2))
		expect(mocks.updateTaskSettings).toHaveBeenNthCalledWith(1, "task-1", {
			actModeReasoningOverrideKind: "effort",
			actModeReasoningOverrideEffort: "low",
		})
		expect(mocks.updateTaskSettings).toHaveBeenNthCalledWith(2, "task-1", {
			actModeServiceTierOverrideKind: "tier",
			actModeServiceTierOverrideTier: "flex",
		})
	})

	it("does not expose internal inheritance as a Profile option", async () => {
		const user = userEvent.setup()
		mocks.state.apiConfiguration = {
			...mocks.state.apiConfiguration,
			actModeReasoningOverride: { kind: "effort", effort: "high" },
			actModeServiceTierOverride: { kind: "tier", tier: "priority" },
		}
		render(<TaskRuntimeControls />)

		const thinkingControl = screen.getByRole("combobox", { name: "Task thinking override" })
		expect(thinkingControl).toHaveTextContent("High")
		await user.click(thinkingControl)
		expect(screen.queryByRole("option", { name: "Profile" })).not.toBeInTheDocument()

		await user.keyboard("{Escape}")
		const serviceTierControl = screen.getByRole("button", { name: "Task service tier" })
		expect(serviceTierControl).toHaveAttribute("title", "Service tier: Priority")
		await user.click(serviceTierControl)
		expect(screen.queryByRole("option", { name: "Profile" })).not.toBeInTheDocument()
		expect(mocks.updateTaskSettings).not.toHaveBeenCalled()
	})

	it("projects budget without Service Tier for a non-OpenAI budget-only model", () => {
		mocks.profiles = [
			{
				id: "openai-id",
				name: "anthropic-budget",
				provider: "anthropic",
				modelId: "claude-test",
				usedFor: [],
				enabled: true,
				modelInfo: {
					capabilities: {
						thinking: { supported: true, maxBudget: 16_384 },
					},
				},
			},
		]
		const { container } = render(<TaskRuntimeControls />)

		expect(screen.getByRole("combobox", { name: "Task thinking override" })).toBeInTheDocument()
		expect(container.querySelector('[data-chat-input-slot="thinking"]')).not.toBeNull()
		expect(screen.queryByRole("button", { name: "Task service tier" })).not.toBeInTheDocument()
	})

	it.each([
		["streaming", { phase: "idle" }, { phase: "idle" }, false],
		["between_turns", { phase: "preflighting" }, { phase: "idle" }, false],
		["between_turns", { phase: "idle" }, { phase: "compacting" }, false],
		["between_turns", { phase: "idle" }, { phase: "idle" }, true],
	] as const)("disables controls for unsafe runtime state %#", (phase, modeSwitch, profileSwitch, invalid) => {
		mocks.state.taskViewState = {
			taskId: "task-1",
			phase,
			...(invalid
				? {
						profileInvalid: {
							reason: "missing" as const,
							message: "Profile not valid",
						},
					}
				: {}),
		}
		mocks.state.modeSwitch = modeSwitch
		mocks.state.profileSwitch = profileSwitch
		render(<TaskRuntimeControls />)

		expect(screen.getByRole("combobox", { name: "Task thinking override" })).toBeDisabled()
		expect(screen.getByRole("button", { name: "Task service tier" })).toBeDisabled()
	})
})
