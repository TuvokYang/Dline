// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { FileServiceClient } from "@/services/grpc-client"
import {
	DEFAULT_TASK_ACTIVITY_FILTERS,
	formatCommandTimeout,
	type TaskActivityFilters,
	TaskActivityPanel,
} from "./TaskActivityPanel"

const cancelTaskActivities = vi.fn()

function ActivitiesTabHarness() {
	const [tab, setTab] = useState<"work" | "activities">("work")
	const [filters, setFilters] = useState<TaskActivityFilters>(DEFAULT_TASK_ACTIVITY_FILTERS)

	return (
		<div>
			<button onClick={() => setTab("work")} type="button">
				Work
			</button>
			<button onClick={() => setTab("activities")} type="button">
				Activities
			</button>
			{tab === "activities" && <TaskActivityPanel filters={filters} onFiltersChange={setFilters} taskId="task-1" />}
		</div>
	)
}

function FocusActivityHarness() {
	const [focusActivityId, setFocusActivityId] = useState<string | undefined>("old-agent")
	const [filters, setFilters] = useState<TaskActivityFilters>(DEFAULT_TASK_ACTIVITY_FILTERS)

	return (
		<div>
			<TaskActivityPanel
				filters={filters}
				focusActivityId={focusActivityId}
				onFiltersChange={(nextFilters) => {
					setFilters(nextFilters)
					setFocusActivityId(undefined)
				}}
				taskId="task-1"
			/>
		</div>
	)
}

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: {
		openFile: vi.fn(async () => ({})),
	},
}))

vi.mock("./useTaskActivities", () => ({
	cancelTaskActivities: (...args: unknown[]) => cancelTaskActivities(...args),
	useTaskActivities: () => ({
		activities: [
			{
				activityId: "new-command",
				taskId: "task-1",
				kind: "command",
				executionMode: "background",
				status: "running",
				cancellable: true,
				createdAt: 200,
				updatedAt: 200,
				timeoutSeconds: 0,
				title: "new command",
				detail: "npm run test:run -- src/example.test.ts",
				logPath: "C:\\Temp\\activity.log",
				output: "actual stdout\nold progress\r\x1b[31mfailed\x1b[0m\tcolumn\b\n\x1b]0;C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\x1b\\\x1b[0m(base) \x1b[0m\n",
				events: [
					{
						sequence: 1,
						timestamp: 200,
						kind: "status",
						status: "running",
						text: "Activity started",
					},
					{
						sequence: 2,
						timestamp: 201,
						kind: "output",
						text: "actual stdout\n",
					},
					{
						sequence: 3,
						timestamp: 202,
						kind: "metrics",
						metrics: {
							toolCalls: 0,
							inputTokens: 0,
							outputTokens: 0,
							totalCost: 0,
							currency: "",
							contextTokens: 0,
							contextWindow: 0,
							lineCount: 1,
						},
					},
				],
			},
			{
				activityId: "stale-command",
				taskId: "task-1",
				kind: "command",
				executionMode: "background",
				status: "interrupted",
				cancellable: false,
				createdAt: 175,
				updatedAt: 180,
				finishedAt: 180,
				timeoutSeconds: -1,
				title: "stale command",
				latestEvent: "Interrupted before completion",
				events: [
					{
						sequence: 1,
						timestamp: 180,
						kind: "status",
						status: "interrupted",
						text: "Interrupted before completion",
					},
				],
			},
			{
				activityId: "skipped-command",
				taskId: "task-1",
				kind: "command",
				executionMode: "foreground",
				status: "skipped",
				cancellable: false,
				createdAt: 160,
				updatedAt: 160,
				finishedAt: 160,
				title: "skipped command",
				detail: "npm run skipped",
				latestEvent: "Skipped by user",
				events: [],
			},
			{
				activityId: "old-agent",
				taskId: "task-1",
				kind: "subagent",
				executionMode: "foreground",
				status: "completed",
				createdAt: 100,
				updatedAt: 150,
				title: "old agent",
				events: [
					{
						sequence: 1,
						timestamp: 101,
						kind: "thinking",
						phase: "final",
						text: "Inspect the cancellation path.",
					},
					{
						sequence: 2,
						timestamp: 110,
						kind: "assistant_message",
						phase: "final",
						text: "I will read the executor.",
					},
					{
						sequence: 3,
						timestamp: 120,
						kind: "tool_call",
						toolCallId: "tid-1",
						toolName: "read_file",
						toolStatus: "completed",
						summary: "read executor",
						durationMs: 8,
					},
					{
						sequence: 4,
						timestamp: 121,
						kind: "tool_result",
						toolCallId: "tid-1",
						toolName: "read_file",
						text: "executor content",
					},
					{
						sequence: 5,
						timestamp: 140,
						kind: "metrics",
						metrics: { toolCalls: 1, inputTokens: 10, outputTokens: 5, totalCost: 0.01, currency: "USD" },
					},
				],
			},
		],
	}),
}))

describe("TaskActivityPanel", () => {
	beforeEach(() => {
		cancelTaskActivities.mockClear()
		vi.mocked(FileServiceClient.openFile).mockClear()
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: vi.fn(),
		})
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: vi.fn(async () => undefined) },
		})
	})

	it("formats command timeouts in seconds and hours", () => {
		expect(formatCommandTimeout(60)).toBe("60 s")
		expect(formatCommandTimeout(3600)).toBe("1.0 h")
	})

	it("expands and scrolls to an activity selected from the work view", async () => {
		render(<TaskActivityPanel focusActivityId="new-command" taskId="task-1" />)

		const item = screen
			.getAllByTestId("activity-item")
			.find((candidate) => candidate.getAttribute("data-activity-id") === "new-command") as HTMLElement
		expect(item).toHaveTextContent("actual stdout")
		await waitFor(() => expect(item.scrollIntoView).toHaveBeenCalledWith({ block: "center" }))
	})

	it("shows only the focused activity without changing the saved filters", () => {
		render(<TaskActivityPanel filters={{ status: "active", kind: "all" }} focusActivityId="old-agent" taskId="task-1" />)

		const items = screen.getAllByTestId("activity-item")
		expect(items).toHaveLength(1)
		expect(items[0]).toHaveAttribute("data-activity-id", "old-agent")
		expect(within(items[0]).getByTestId("activity-timeline")).toBeInTheDocument()
	})

	it("preserves filters when switching away from and back to Activities", () => {
		render(<ActivitiesTabHarness />)

		fireEvent.click(screen.getByRole("button", { name: "Activities" }))
		fireEvent.click(screen.getByTestId("activity-status-filter-all"))
		fireEvent.click(screen.getByTestId("activity-kind-filter-subagent"))
		expect(screen.getAllByTestId("activity-item")).toHaveLength(1)
		expect(screen.getByTestId("activity-item")).toHaveAttribute("data-activity-id", "old-agent")

		fireEvent.click(screen.getByRole("button", { name: "Work" }))
		expect(screen.queryByTestId("activity-list")).not.toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "Activities" }))

		expect(screen.getByTestId("activity-status-filter-all")).toHaveClass("border-link")
		expect(screen.getByTestId("activity-kind-filter-subagent")).toHaveClass("border-link")
		expect(screen.getByTestId("activity-item")).toHaveAttribute("data-activity-id", "old-agent")
	})

	it("releases a focused activity when the user changes a filter", () => {
		render(<FocusActivityHarness />)

		expect(screen.getByTestId("activity-item")).toHaveAttribute("data-activity-id", "old-agent")
		fireEvent.click(screen.getByTestId("activity-status-filter-all"))

		const items = screen.getAllByTestId("activity-item")
		expect(items).toHaveLength(4)
	})

	it("defaults to active activities in creation order and exposes exact cancellation", () => {
		render(<TaskActivityPanel taskId="task-1" />)

		const items = screen.getAllByTestId("activity-item")
		expect(items).toHaveLength(1)
		expect(screen.getByTestId("activity-list")).toHaveClass("space-y-3")
		expect(items[0]).toHaveClass("border-editor-widget-border/60", "overflow-hidden")
		expect(within(items[0]).getByTestId("activity-header")).toHaveClass("bg-toolbar-hover/30")
		expect(within(items[0]).getByTestId("activity-status-accent")).toHaveClass("bg-link")
		expect(within(items[0]).getByText("new command")).toBeInTheDocument()
		expect(within(items[0]).getByText("new command")).toHaveClass("font-mono", "font-semibold")
		expect(within(items[0]).getByTestId("activity-kind-icon")).toHaveClass("lucide-terminal")
		expect(within(items[0]).getByTestId("activity-execution-mode")).toHaveTextContent("Background")
		expect(within(items[0]).getByTestId("activity-execution-mode")).toHaveClass(
			"bg-editor-warning-foreground/10",
			"text-editor-warning-foreground",
		)
		expect(within(items[0]).queryByLabelText(/Command timeout:/)).not.toBeInTheDocument()
		expect(within(items[0]).queryByText("Command", { exact: true })).not.toBeInTheDocument()
		const metadata = within(items[0]).getByTestId("activity-metadata")
		const environmentMode = within(items[0]).getByTestId("activity-environment-mode")
		const environmentLabel = within(items[0]).getByTestId("activity-environment-label")
		expect(environmentLabel).toHaveTextContent("(base)")
		expect(environmentMode).toHaveClass("w-fit", "max-w-full", "flex-nowrap")
		expect(environmentLabel).toHaveClass("max-w-[60%]", "flex-auto", "truncate")
		expect(environmentLabel.parentElement).toBe(environmentMode)
		expect(environmentMode.parentElement).toBe(metadata)
		expect(environmentMode.firstElementChild).toBe(environmentLabel)
		expect(environmentMode.lastElementChild).toBe(within(items[0]).getByTestId("activity-execution-mode"))
		const summary = within(items[0]).getByTestId("activity-output-summary")
		expect(summary.textContent).toBe("failed→   column⌫")
		expect(summary.textContent).not.toContain("\x1b")
		expect(summary).not.toHaveTextContent("old progress")

		const cancelButton = within(items[0]).getByRole("button", { name: "Cancel" })
		expect(cancelButton).toHaveClass("h-5", "self-center", "bg-button-background", "text-[11px]")
		fireEvent.click(cancelButton)
		expect(cancelTaskActivities).toHaveBeenCalledWith("task-1", ["new-command"])
	})

	it("renders recovered activities as interrupted without a spinner or cancellation action", () => {
		render(<TaskActivityPanel taskId="task-1" />)
		fireEvent.click(screen.getAllByRole("button", { name: "All" })[0])

		const interrupted = screen.getAllByTestId("activity-item").find((item) => item.textContent?.includes("stale command"))
		expect(interrupted).toBeDefined()
		expect(interrupted).toHaveTextContent("interrupted")
		expect(interrupted?.querySelector(".animate-spin")).toBeNull()
		expect(within(interrupted as HTMLElement).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument()
	})

	it("renders a skipped command with the neutral stopped icon", () => {
		render(<TaskActivityPanel taskId="task-1" />)
		fireEvent.click(screen.getAllByRole("button", { name: "All" })[0])

		const skipped = screen.getAllByTestId("activity-item").find((item) => item.textContent?.includes("skipped command"))
		expect(skipped).toBeDefined()
		expect(skipped?.querySelector(".lucide-circle-slash")).not.toBeNull()
		expect(skipped?.querySelector(".lucide-circle-x")).toBeNull()
		expect(within(skipped as HTMLElement).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument()
	})

	it("opens a background command log from the active activity", () => {
		render(<TaskActivityPanel taskId="task-1" />)

		const item = screen.getByTestId("activity-item")
		fireEvent.click(within(item).getByRole("button", { name: /new command/i }))
		expect(within(item).queryByTestId("activity-output-summary")).not.toBeInTheDocument()
		fireEvent.click(within(item).getByRole("button", { name: "Open log file activity.log" }))

		expect(FileServiceClient.openFile).toHaveBeenCalledWith(expect.objectContaining({ value: "C:\\Temp\\activity.log" }))
	})

	it("renders ANSI and control characters with the output log after command output", () => {
		render(<TaskActivityPanel taskId="task-1" />)

		const item = screen.getByTestId("activity-item")
		fireEvent.click(within(item).getByRole("button", { name: /new command/i }))

		const ansiText = within(item).getByText("failed")
		const output = ansiText.closest("pre")
		const logButton = within(item).getByRole("button", { name: "Open log file activity.log" })
		const activityBody = within(item).getByTestId("activity-body")
		const commandLine = within(item).getByTestId("activity-command-line")
		const commandOutput = within(item).getByTestId("activity-command-output")
		const logRow = within(item).getByTestId("activity-log-row")
		expect(ansiText.getAttribute("style")).toContain("color")
		expect(item.textContent).toContain("→   column⌫")
		expect(item.textContent).not.toContain("\x1b")
		expect(commandOutput).not.toHaveTextContent("(base)")
		expect(activityBody).toHaveClass("border-editor-widget-border/25")
		expect(activityBody).not.toHaveClass("max-h-[60vh]", "overflow-y-auto")
		expect(commandLine).toHaveClass("bg-code", "max-h-[72px]", "overflow-y-auto")
		expect(commandLine).toHaveTextContent("npm run test:run -- src/example.test.ts")
		expect(commandOutput).toHaveClass("border-editor-widget-border/25", "rounded-none")
		expect(commandOutput).not.toHaveClass("border-editor-group-border", "rounded-sm")
		expect(within(commandOutput).getByTestId("command-output-scroll")).toHaveClass("overflow-auto")
		expect(logRow).toHaveClass("border-editor-widget-border/25", "bg-toolbar-hover/20")
		expect(output).not.toBeNull()
		expect(commandLine.compareDocumentPosition(commandOutput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
		expect((output as HTMLElement).compareDocumentPosition(logButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
	})

	it("copies the full command from a command activity", async () => {
		render(<TaskActivityPanel taskId="task-1" />)

		fireEvent.click(screen.getByRole("button", { name: "Copy command" }))

		await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("npm run test:run -- src/example.test.ts"))
	})

	it("renders command output once without a synthetic event timeline or token metrics", () => {
		render(<TaskActivityPanel taskId="task-1" />)

		const item = screen.getByTestId("activity-item")
		fireEvent.click(within(item).getByRole("button", { name: /new command/i }))

		expect(item.textContent?.match(/actual stdout/g)).toHaveLength(1)
		expect(within(item).queryByTestId("activity-timeline")).not.toBeInTheDocument()
		expect(item).not.toHaveTextContent(/\d+ tools/)
		expect(item).not.toHaveTextContent(/\d+ tokens/)
	})

	it("renders an ordered typed timeline with thinking, conversation, tools, results, and metrics", () => {
		render(<TaskActivityPanel taskId="task-1" />)
		fireEvent.click(screen.getAllByRole("button", { name: "All" })[0])
		const oldAgent = screen.getAllByTestId("activity-item").find((item) => item.textContent?.includes("old agent"))
		expect(oldAgent).toBeDefined()
		fireEvent.click(within(oldAgent as HTMLElement).getByRole("button", { name: /old agent/i }))

		const timeline = within(oldAgent as HTMLElement).getByTestId("activity-timeline")
		const events = within(timeline).getAllByTestId("activity-event")
		expect(events.map((event) => event.textContent)).toEqual([
			expect.stringContaining("Thinking"),
			expect.stringContaining("Assistant"),
			expect.stringContaining("read_file"),
			expect.stringContaining("executor content"),
			expect.stringContaining("1 tools"),
		])
	})

	it("shows all activities and filters the vertical list by type", () => {
		render(<TaskActivityPanel taskId="task-1" />)
		fireEvent.click(screen.getAllByRole("button", { name: "All" })[0])

		let items = screen.getAllByTestId("activity-item")
		expect(items.map((item) => item.textContent)).toEqual([
			expect.stringContaining("new command"),
			expect.stringContaining("stale command"),
			expect.stringContaining("skipped command"),
			expect.stringContaining("old agent"),
		])

		fireEvent.click(screen.getByRole("button", { name: "Subagents" }))
		items = screen.getAllByTestId("activity-item")
		expect(items).toHaveLength(1)
		expect(within(items[0]).getByText("old agent")).toBeInTheDocument()
	})
})
