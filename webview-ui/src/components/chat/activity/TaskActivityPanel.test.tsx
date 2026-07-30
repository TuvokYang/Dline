// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { FileServiceClient } from "@/services/grpc-client"
import { TaskActivityPanel } from "./TaskActivityPanel"

const cancelTaskActivities = vi.fn()

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
				title: "new command",
				detail: "npm run test:run -- src/example.test.ts",
				logPath: "C:\\Temp\\activity.log",
				output: "actual stdout\n",
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
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: vi.fn(async () => undefined) },
		})
	})

	it("defaults to active activities in creation order and exposes exact cancellation", () => {
		render(<TaskActivityPanel taskId="task-1" />)

		const items = screen.getAllByTestId("activity-item")
		expect(items).toHaveLength(1)
		expect(within(items[0]).getByText("new command")).toBeInTheDocument()
		expect(within(items[0]).getByText(/Background Command/)).toBeInTheDocument()

		fireEvent.click(within(items[0]).getByRole("button", { name: "Cancel" }))
		expect(cancelTaskActivities).toHaveBeenCalledWith("task-1", ["new-command"])
	})

	it("opens a background command log from the active activity", () => {
		render(<TaskActivityPanel taskId="task-1" />)

		const item = screen.getByTestId("activity-item")
		fireEvent.click(within(item).getByRole("button", { name: /new command/i }))
		fireEvent.click(within(item).getByRole("button", { name: "Open log file activity.log" }))

		expect(FileServiceClient.openFile).toHaveBeenCalledWith(expect.objectContaining({ value: "C:\\Temp\\activity.log" }))
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
			expect.stringContaining("old agent"),
		])

		fireEvent.click(screen.getByRole("button", { name: "Subagents" }))
		items = screen.getAllByTestId("activity-item")
		expect(items).toHaveLength(1)
		expect(within(items[0]).getByText("old agent")).toBeInTheDocument()
	})
})
