import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ModelSwitcher from "./ModelSwitcher"

const mocks = vi.hoisted(() => ({
	state: {
		apiConfiguration: {
			planModeProfileId: "large-id",
			planModeProfile: "large-profile",
			actModeProfileId: "large-id",
			actModeProfile: "large-profile",
		},
		mode: "act" as const,
		planActSeparateModelsSetting: false,
		currentTaskItem: { id: "task-1" },
		taskTitleMessage: { ts: 1, type: "say", say: "task", text: "task" },
		taskViewState: { taskId: "task-1", phase: "completed" as const },
		profileSwitch: { phase: "idle" as const },
		stateRevision: 1,
	},
	requestSwitch: vi.fn(),
	confirmSwitch: vi.fn(),
	cancelSwitch: vi.fn(),
	selectProfile: vi.fn(),
	selectProfiles: vi.fn(),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => mocks.state,
}))

vi.mock("@/components/settings/providers/useApiProfiles", () => ({
	useApiProfiles: () => ({
		profiles: [
			{ id: "large-id", name: "large-profile", provider: "test", modelId: "large", usedFor: [] },
			{ id: "small-id", name: "small-profile", provider: "test", modelId: "small", usedFor: [] },
		],
		selectProfile: mocks.selectProfile,
		selectProfiles: mocks.selectProfiles,
	}),
}))

vi.mock("@/components/settings/utils/settingsHandlers", () => ({
	updateSetting: vi.fn(),
}))

vi.mock("../profile-switch/useProfileSwitch", () => ({
	useProfileSwitch: () => ({
		requestSwitch: mocks.requestSwitch,
		confirmSwitch: mocks.confirmSwitch,
		cancelSwitch: mocks.cancelSwitch,
		isSwitchPending: false,
		statusText: undefined,
		error: undefined,
	}),
}))

describe("ModelSwitcher Profile transitions", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.state.currentTaskItem = { id: "task-1" }
		mocks.state.taskTitleMessage = { ts: 1, type: "say", say: "task", text: "task" }
		mocks.state.taskViewState = { taskId: "task-1", phase: "completed" }
		mocks.state.apiConfiguration = {
			planModeProfileId: "large-id",
			planModeProfile: "large-profile",
			actModeProfileId: "large-id",
			actModeProfile: "large-profile",
		}
	})

	it("resolves a renamed active Profile by stable identity", () => {
		mocks.state.apiConfiguration = {
			planModeProfileId: "large-id",
			planModeProfile: "old-profile-name",
			actModeProfileId: "large-id",
			actModeProfile: "old-profile-name",
		}

		render(<ModelSwitcher onOpenSettings={vi.fn()} />)

		const profileButton = screen.getByRole("button", { name: "Select model" })
		const profileText = profileButton.querySelector<HTMLElement>("[data-chat-input-profile-text]")
		expect(profileButton).toHaveTextContent("large-profile")
		expect(profileButton).toHaveClass(
			"inline-flex",
			"h-[18.5px]",
			"items-center",
			"overflow-hidden",
			"rounded-sm",
			"px-1",
			"text-[12.5px]",
			"leading-none",
			"transition-colors",
			"hover:bg-toolbar-hover",
			"hover:text-foreground",
		)
		expect(profileText).toHaveClass("block", "min-w-0", "flex-1", "truncate")
	})

	it("uses the shared menu surface for the Profile list", () => {
		render(<ModelSwitcher onOpenSettings={vi.fn()} />)

		fireEvent.click(screen.getByRole("button", { name: "Select model" }))

		expect(screen.getByTestId("profile-menu")).toHaveClass("bg-menu", "text-menu-foreground", "border-editor-group-border")
		expect(screen.getByTestId("profile-menu")).not.toHaveStyle({
			background: "var(--vscode-dropdown-background)",
		})
	})

	it("routes an active Task selection through the Profile transition transaction", () => {
		render(<ModelSwitcher onOpenSettings={vi.fn()} />)

		fireEvent.click(screen.getByRole("button", { name: "Select model" }))
		fireEvent.click(screen.getByRole("option", { name: /small-profile/ }))

		expect(mocks.requestSwitch).toHaveBeenCalledWith("small-id", ["plan", "act"])
		expect(mocks.selectProfiles).not.toHaveBeenCalled()
		expect(mocks.selectProfile).not.toHaveBeenCalled()
	})

	it("routes a completed but still open Task through the Profile transition transaction", () => {
		mocks.state.currentTaskItem = undefined
		mocks.state.taskTitleMessage = undefined
		mocks.state.taskViewState = { taskId: "task-completed", phase: "completed" }
		render(<ModelSwitcher onOpenSettings={vi.fn()} />)

		fireEvent.click(screen.getByRole("button", { name: "Select model" }))
		fireEvent.click(screen.getByRole("option", { name: /small-profile/ }))

		expect(mocks.requestSwitch).toHaveBeenCalledWith("small-id", ["plan", "act"])
		expect(mocks.selectProfiles).not.toHaveBeenCalled()
	})

	it("keeps welcome-screen Profile selection on the global settings path", () => {
		mocks.state.currentTaskItem = undefined
		mocks.state.taskTitleMessage = undefined
		mocks.state.taskViewState = undefined
		render(<ModelSwitcher onOpenSettings={vi.fn()} />)

		fireEvent.click(screen.getByRole("button", { name: "Select model" }))
		fireEvent.click(screen.getByRole("option", { name: /small-profile/ }))

		expect(mocks.selectProfiles).toHaveBeenCalledWith("small-id", ["plan", "act"], undefined, false)
		expect(mocks.requestSwitch).not.toHaveBeenCalled()
	})
})
