import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { TaskRuntimeControls } from "./TaskRuntimeControls"
import { TaskServiceTierControl } from "./TaskServiceTierControl"

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
	providerCatalogAvailable: true,
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

vi.mock("@components/settings/providers/useProviderModels", () => ({
	useProviderModels: (providerId: string) => ({
		models: !mocks.providerCatalogAvailable
			? {}
			: providerId === "deepseek"
				? {
						"deepseek-v4-flash": {
							id: "deepseek-v4-flash",
							capabilities: { supportsReasoning: true },
						},
					}
				: providerId === "anthropic"
					? {
							"claude-sonnet-4-6": {
								id: "claude-sonnet-4-6",
								capabilities: { supportsReasoning: true },
							},
						}
					: {},
		defaultModelId: !mocks.providerCatalogAvailable
			? ""
			: providerId === "deepseek"
				? "deepseek-v4-flash"
				: providerId === "anthropic"
					? "claude-sonnet-4-6"
					: "",
	}),
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
		mocks.providerCatalogAvailable = true
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

	it("hides Task-local controls when no Task is open", () => {
		Object.assign(mocks.state, {
			currentTaskItem: undefined,
			taskTitleMessage: undefined,
			taskViewState: undefined,
		})
		const { container } = render(<TaskRuntimeControls />)

		expect(container).toBeEmptyDOMElement()
		expect(screen.queryByRole("combobox", { name: "Task thinking override" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Task service tier" })).not.toBeInTheDocument()
	})

	it("keeps Task-local controls visible while the title message is absent from an active Task state window", () => {
		mocks.state.taskTitleMessage = undefined
		render(<TaskRuntimeControls />)

		expect(screen.getByRole("combobox", { name: "Task thinking override" })).toHaveTextContent("High")
		expect(screen.getByRole("button", { name: "Task service tier" })).toBeInTheDocument()
	})

	it("keeps Thinking visible but hides Task Service Tier when the Profile disables it", () => {
		mocks.profiles = [
			{
				...mocks.profiles[0],
				openai: { ...mocks.profiles[0].openai, serviceTierEnabled: false },
			},
		]

		render(<TaskRuntimeControls />)

		expect(screen.getByRole("combobox", { name: "Task thinking override" })).toHaveTextContent("High")
		expect(screen.queryByRole("button", { name: "Task service tier" })).not.toBeInTheDocument()
	})

	it("projects Profile effort from provider capabilities before top-level modelInfo is hydrated", () => {
		mocks.profiles = [
			{
				id: "openai-id",
				name: "renamed-openai",
				provider: "openai",
				modelId: "gpt-test",
				usedFor: [],
				enabled: true,
				openai: {
					capabilities: { supportsReasoning: true },
					reasoning: { enableThinking: true, effort: "high", thinkingBudget: 0 },
					serviceTier: "priority",
				},
			},
		]
		render(<TaskRuntimeControls />)

		expect(screen.getByRole("combobox", { name: "Task thinking override" })).toHaveTextContent("High")
	})

	it("projects Anthropic budget from Provider enable config before model capability hydration", () => {
		mocks.providerCatalogAvailable = false
		mocks.state.apiConfiguration = {
			...mocks.state.apiConfiguration,
			actModeProfileId: "anthropic-id",
			actModeProfile: "anthropic-thinking",
		}
		mocks.profiles = [
			{
				id: "anthropic-id",
				name: "anthropic-thinking",
				provider: "anthropic",
				modelId: "claude-sonnet-4-6",
				usedFor: [],
				enabled: true,
				anthropic: {
					reasoning: { enableThinking: true, thinkingBudget: 2_048 },
				},
			},
		]
		render(<TaskRuntimeControls />)

		expect(screen.getByRole("combobox", { name: "Task thinking override" })).toHaveTextContent("Budget")
		expect(screen.getByRole("spinbutton", { name: "Task thinking budget" })).toHaveValue(2_048)
	})

	it("projects DeepSeek low/high/max from Provider enable config before model capability hydration", async () => {
		const user = userEvent.setup()
		mocks.providerCatalogAvailable = false
		mocks.profiles = [
			{
				id: "openai-id",
				name: "deepseek-thinking",
				provider: "deepseek",
				modelId: "deepseek-v4-flash",
				usedFor: [],
				enabled: true,
				deepseek: {
					reasoning: { enableThinking: true, effort: "high", thinkingBudget: 0 },
				},
			},
		]
		render(<TaskRuntimeControls />)

		const thinkingControl = screen.getByRole("combobox", { name: "Task thinking override" })
		expect(thinkingControl).toBeEnabled()
		expect(thinkingControl).toHaveTextContent("High")
		expect(screen.queryByRole("button", { name: "Task service tier" })).not.toBeInTheDocument()
		await user.click(thinkingControl)
		expect(screen.getByRole("option", { name: "Low" })).toBeInTheDocument()
		expect(screen.getByRole("option", { name: "High" })).toBeInTheDocument()
		expect(screen.getByRole("option", { name: "Max" })).toBeInTheDocument()
		expect(screen.queryByRole("option", { name: "Xhigh" })).not.toBeInTheDocument()
		await user.click(screen.getByRole("option", { name: "Low" }))

		await waitFor(() => expect(mocks.updateTaskSettings).toHaveBeenCalledTimes(1))
		expect(mocks.updateTaskSettings).toHaveBeenCalledWith("task-1", {
			actModeReasoningOverrideKind: "effort",
			actModeReasoningOverrideEffort: "low",
		})
		expect(screen.getByRole("combobox", { name: "Task thinking override" })).toHaveTextContent("Low")

		await user.click(screen.getByRole("combobox", { name: "Task thinking override" }))
		await user.click(screen.getByRole("option", { name: "Max" }))

		await waitFor(() => expect(mocks.updateTaskSettings).toHaveBeenCalledTimes(2))
		expect(mocks.updateTaskSettings).toHaveBeenLastCalledWith("task-1", {
			actModeReasoningOverrideKind: "effort",
			actModeReasoningOverrideEffort: "max",
		})
		expect(screen.getByRole("combobox", { name: "Task thinking override" })).toHaveTextContent("Max")
	})

	it("hides Thinking when the Provider explicitly disables it despite model support", () => {
		mocks.profiles = [
			{
				id: "openai-id",
				name: "deepseek-disabled",
				provider: "deepseek",
				modelId: "deepseek-v4-flash",
				usedFor: [],
				enabled: true,
				deepseek: {
					reasoning: { enableThinking: false },
				},
			},
		]

		const { container } = render(<TaskRuntimeControls />)

		expect(screen.queryByRole("combobox", { name: "Task thinking override" })).not.toBeInTheDocument()
		expect(container).toBeEmptyDOMElement()
	})

	it("hides Thinking when capability explicitly rejects a Provider enable config", () => {
		mocks.providerCatalogAvailable = false
		mocks.profiles = [
			{
				id: "openai-id",
				name: "deepseek-unsupported",
				provider: "deepseek",
				modelId: "custom-deepseek",
				usedFor: [],
				enabled: true,
				deepseek: {
					capabilities: { supportsReasoning: false },
					reasoning: { enableThinking: true, effort: "high" },
				},
			},
		]

		const { container } = render(<TaskRuntimeControls />)

		expect(screen.queryByRole("combobox", { name: "Task thinking override" })).not.toBeInTheDocument()
		expect(container).toBeEmptyDOMElement()
	})

	it("projects Profile budget and durably submits edited tokens", async () => {
		const user = userEvent.setup()
		mocks.profiles = [
			{
				id: "openai-id",
				name: "anthropic-budget",
				provider: "anthropic",
				modelId: "claude-test",
				usedFor: [],
				enabled: true,
				anthropic: {
					capabilities: { thinking: { supported: true, mode: "budget", maxBudget: 16_384 } },
					reasoning: { enableThinking: true, thinkingBudget: 2_048 },
				},
			},
		]
		render(<TaskRuntimeControls />)

		expect(screen.getByRole("combobox", { name: "Task thinking override" })).toHaveTextContent("Budget")
		const budgetInput = screen.getByRole("spinbutton", { name: "Task thinking budget" })
		expect(budgetInput).toBeEnabled()
		expect(budgetInput).toHaveValue(2_048)
		await user.clear(budgetInput)
		await user.type(budgetInput, "4096")
		await user.tab()

		await waitFor(() => expect(mocks.updateTaskSettings).toHaveBeenCalledTimes(1))
		expect(mocks.updateTaskSettings).toHaveBeenCalledWith("task-1", {
			actModeReasoningOverrideKind: "budget",
			actModeThinkingBudgetTokens: 4_096,
		})
		expect(screen.queryByRole("button", { name: "Task service tier" })).not.toBeInTheDocument()
	})

	it("uses the active mode Task override ahead of that mode Profile default", async () => {
		mocks.state.apiConfiguration = {
			...mocks.state.apiConfiguration,
			planModeProfileId: "plan-id",
			planModeProfile: "plan-profile",
			planModeReasoningOverride: { kind: "effort", effort: "low" },
		}
		mocks.profiles = [
			mocks.profiles[0],
			{
				...mocks.profiles[0],
				id: "plan-id",
				name: "plan-profile",
				openai: {
					...mocks.profiles[0].openai,
					reasoning: { enableThinking: true, effort: "medium", thinkingBudget: 0 },
				},
			},
		]
		const { rerender } = render(<TaskRuntimeControls />)
		expect(screen.getByRole("combobox", { name: "Task thinking override" })).toHaveTextContent("High")

		mocks.state.mode = "plan"
		rerender(<TaskRuntimeControls />)

		await waitFor(() => expect(screen.getByRole("combobox", { name: "Task thinking override" })).toHaveTextContent("Low"))
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
		expect(serviceTierControl).toHaveClass("border-0", "shadow-none", "p-0", "size-4")
		expect(screen.getByTestId("task-service-tier-icon")).toHaveAttribute("data-service-tier-icon", "priority")
		expect(screen.getByTestId("task-service-tier-icon")).toHaveClass("size-3")
		expect(screen.queryByText("Tier")).not.toBeInTheDocument()
		expect(screen.queryByText("Thinking", { exact: true })).not.toBeInTheDocument()
		expect(container.querySelector('[data-chat-input-slot="thinking"]')).toHaveClass(
			"min-w-[4ch]",
			"max-w-[8ch]",
			"flex-[0_1_auto]",
			"overflow-hidden",
		)
		expect(container.querySelector('[data-chat-input-slot="service-tier"]')).toHaveClass("shrink-0")

		await user.click(serviceTierControl)
		const tierOptions = screen.getByRole("listbox", { name: "Task service tier options" })
		expect(tierOptions).toBeInTheDocument()
		expect(tierOptions.getAttribute("style")).toContain("background: var(--vscode-dropdown-background)")
		expect(tierOptions.getAttribute("style")).toContain("border-color: var(--vscode-dropdown-border)")
		const selectedTier = screen.getByRole("option", { name: "Priority" })
		expect(selectedTier.getAttribute("style")).toContain("border-bottom: 1px solid var(--vscode-dropdown-border)")
		expect(selectedTier.querySelector('[data-profile-style-selection="true"]')).toHaveClass("rounded-full")
		expect(screen.queryByRole("option", { name: "Profile" })).not.toBeInTheDocument()
		for (const tier of ["Auto", "Default", "Flex", "Scale", "Priority", "Ultrafast"]) {
			const optionValue = tier.toLowerCase()
			const option = screen.getByRole("option", { name: tier })
			expect(option).toBeInTheDocument()
			expect(option.querySelector(`[data-service-tier-option-icon="${optionValue}"]`)).toHaveClass("mr-2", "size-4")
			expect(option.querySelector(`[data-service-tier-option-icon="${optionValue}"] svg`)).toHaveClass("size-3")
			expect(option.querySelector(`[data-service-tier-option-label="${optionValue}"]`)).toHaveTextContent(tier)
		}
		await user.click(serviceTierControl)

		await user.click(thinkingControl)
		expect(screen.getByRole("option", { name: "High" })).toBeInTheDocument()
		expect(screen.queryByRole("option", { name: "Profile" })).not.toBeInTheDocument()
		expect(document.querySelector('[data-slot="select-content"]')).toHaveClass("bg-menu")
	})

	it("changes the Service Tier trigger icon with the selected tier", () => {
		const onSelect = vi.fn()
		const { rerender } = render(<TaskServiceTierControl onSelect={onSelect} value="auto" />)
		const expectStandardIcon = (tier: string, pathCount: number) => {
			const icon = screen.getByTestId("task-service-tier-icon")
			expect(icon).toHaveAttribute("data-service-tier-icon", tier)
			expect(icon).toHaveClass("size-3")
			expect(icon).toHaveAttribute("fill", "none")
			expect(icon).toHaveAttribute("stroke", "currentColor")
			expect(icon).toHaveAttribute("stroke-width", "0.8")
			expect(icon).toHaveAttribute("viewBox", "0 0 24 24")
			expect(icon.querySelectorAll("path")).toHaveLength(pathCount)
		}

		expectStandardIcon("auto", 5)

		rerender(<TaskServiceTierControl onSelect={onSelect} value="default" />)
		expectStandardIcon("default", 2)

		rerender(<TaskServiceTierControl onSelect={onSelect} value="flex" />)
		expectStandardIcon("flex", 5)

		rerender(<TaskServiceTierControl onSelect={onSelect} value="scale" />)
		expectStandardIcon("scale", 3)

		rerender(<TaskServiceTierControl onSelect={onSelect} value="priority" />)
		expectStandardIcon("priority", 1)

		rerender(<TaskServiceTierControl onSelect={onSelect} value="ultrafast" />)
		const ultrafastControl = screen.getByRole("button", { name: "Task service tier" })
		const ultrafastIcon = screen.getByTestId("task-service-tier-icon")
		expect(ultrafastControl).toHaveClass("size-4", "items-center", "justify-center")
		expect(ultrafastIcon).toHaveAttribute("data-service-tier-icon", "ultrafast")
		expect(ultrafastIcon).toHaveClass("size-3")
		expect(ultrafastIcon).toHaveAttribute("stroke", "currentColor")
		expect(ultrafastIcon).toHaveAttribute("stroke-linecap", "round")
		expect(ultrafastIcon).toHaveAttribute("stroke-linejoin", "round")
		expect(ultrafastIcon).toHaveAttribute("viewBox", "0 0 24 24")
		const lightningPaths = ultrafastIcon.querySelectorAll("path")
		expect(lightningPaths).toHaveLength(3)
		expect([...lightningPaths].map((path) => path.getAttribute("data-ultrafast-layer"))).toEqual([
			"rear",
			"middle",
			"primary",
		])
		expect([...lightningPaths].map((path) => path.getAttribute("fill"))).toEqual(["#202020", "#202020", "#202020"])
		expect([...lightningPaths].map((path) => path.getAttribute("stroke-width"))).toEqual(["1.36", "1.19", "1.07"])
		expect([...lightningPaths].map((path) => path.getAttribute("transform"))).toEqual([
			"translate(7.4 1.45) scale(0.59)",
			"translate(4.05 3.15) scale(0.67)",
			"translate(0.85 4.85) scale(0.75)",
		])
		expect(lightningPaths[0]).toHaveAttribute("d", lightningPaths[1].getAttribute("d") ?? "")
		expect(lightningPaths[1]).toHaveAttribute("d", lightningPaths[2].getAttribute("d") ?? "")
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
	] as const)("hides controls instead of exposing a disabled cursor for unsafe runtime state %#", (phase, modeSwitch, profileSwitch, invalid) => {
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
		const { container } = render(<TaskRuntimeControls />)

		expect(screen.queryByRole("combobox", { name: "Task thinking override" })).not.toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "Task service tier" })).not.toBeInTheDocument()
		expect(container.querySelector("[disabled]")).toBeNull()
		expect(container.querySelector('[class*="cursor-not-allowed"]')).toBeNull()
	})
})
