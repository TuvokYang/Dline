// @vitest-environment jsdom

import type { ClineMessage } from "@shared/ExtensionMessage"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import SubagentStatusRow from "./SubagentStatusRow"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ currentTaskItem: { id: "task-1" } }),
}))

const { cancelTaskActivities, moveSubagentToBackground, taskActivities } = vi.hoisted(() => ({
	cancelTaskActivities: vi.fn(),
	moveSubagentToBackground: vi.fn(async () => true),
	taskActivities: [] as Array<Record<string, unknown>>,
}))

vi.mock("./activity/useTaskActivities", () => ({
	cancelTaskActivities: (...args: unknown[]) => cancelTaskActivities(...args),
	moveSubagentToBackground: (...args: unknown[]) => moveSubagentToBackground(...args),
	useTaskActivities: () => ({
		activities: taskActivities,
		activeCount: taskActivities.length,
		getById: (activityId: string) => taskActivities.find((activity) => activity.activityId === activityId),
	}),
}))

vi.mock("../common/MarkdownBlock", () => ({
	default: ({ markdown }: { markdown: string }) => <div>{markdown}</div>,
}))

function makeMsg(overrides: Partial<ClineMessage> = {}): ClineMessage {
	return {
		ts: Date.now(),
		type: "say",
		say: "use_subagents",
		text: JSON.stringify({ prompts: ["do something"] }),
		...overrides,
	}
}

describe("SubagentStatusRow", () => {
	beforeEach(() => {
		cancelTaskActivities.mockClear()
		moveSubagentToBackground.mockClear()
		taskActivities.length = 0
	})

	it("renders disabled error as failed", () => {
		const msg = makeMsg({
			text: JSON.stringify({
				prompts: [],
				error: "subagentsDisabled",
				message: "Subagents are disabled. Enable them in Settings.",
			}),
		})

		render(<SubagentStatusRow isLast={true} message={msg} />)

		expect(screen.getByText(/Subagents are disabled/)).toBeInTheDocument()
	})

	it("renders tooManyPrompts error as failed", () => {
		const msg = makeMsg({
			text: JSON.stringify({
				prompts: ["1", "2", "3", "4", "5"],
				error: "tooManyPrompts",
				message: "Too many subagent prompts provided (6). Maximum is 5.",
				count: 6,
				max: 5,
			}),
		})

		render(<SubagentStatusRow isLast={true} message={msg} />)

		expect(screen.getByText(/Too many subagent prompts/)).toBeInTheDocument()
	})

	it("renders normal prompts as pending", () => {
		const msg = makeMsg({
			ask: "use_subagents",
			type: "ask",
			say: undefined,
			text: JSON.stringify({ prompts: ["do something"] }),
		})

		render(<SubagentStatusRow isLast={true} message={msg} />)

		expect(screen.getByText(/do something/)).toBeInTheDocument()
	})

	it("uses canonical live activity to keep cancellation available after resume", () => {
		taskActivities.push({
			activityId: "job-1",
			taskId: "task-1",
			kind: "subagent",
			executionMode: "background",
			status: "running",
			cancellable: true,
			createdAt: 1,
			updatedAt: 1,
			title: "reviewer",
		})
		const msg = makeMsg({
			say: "subagent",
			text: JSON.stringify({
				status: "running",
				items: [
					{
						index: 1,
						jobId: "job-1",
						prompt: "review",
						status: "running",
						toolCalls: 0,
						inputTokens: 0,
						outputTokens: 0,
						totalCost: 0,
						currency: "USD",
						contextTokens: 0,
						contextWindow: 0,
						contextUsagePercentage: 0,
					},
				],
			}),
		})

		render(
			<SubagentStatusRow
				isLast={false}
				lastModifiedMessage={{ ts: msg.ts + 1, type: "ask", ask: "resume_task" }}
				message={msg}
			/>,
		)
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

		expect(cancelTaskActivities).toHaveBeenCalledWith("task-1", ["job-1"])
	})

	it("hides cancellation for a running activity without a live canceller", () => {
		taskActivities.push({
			activityId: "job-stale",
			taskId: "task-1",
			kind: "subagent",
			executionMode: "background",
			status: "running",
			cancellable: false,
			createdAt: 1,
			updatedAt: 1,
			title: "stale reviewer",
		})
		const msg = makeMsg({
			say: "subagent",
			text: JSON.stringify({
				status: "running",
				items: [
					{
						index: 1,
						jobId: "job-stale",
						prompt: "review",
						status: "running",
						toolCalls: 0,
						inputTokens: 0,
						outputTokens: 0,
						totalCost: 0,
						currency: "USD",
						contextTokens: 0,
						contextWindow: 0,
						contextUsagePercentage: 0,
					},
				],
			}),
		})

		render(<SubagentStatusRow isLast={true} message={msg} />)

		expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument()
	})

	it("shows the cancelled terminal state for a background subagent", () => {
		const msg = makeMsg({
			say: "subagent",
			text: JSON.stringify({
				status: "cancelled",
				items: [
					{
						index: 1,
						jobId: "job-cancelled",
						prompt: "review",
						status: "cancelled",
						background: true,
						error: "Subagent run cancelled.",
						toolCalls: 0,
						inputTokens: 0,
						outputTokens: 0,
						totalCost: 0,
						currency: "USD",
						contextTokens: 0,
						contextWindow: 0,
						contextUsagePercentage: 0,
					},
				],
			}),
		})

		render(<SubagentStatusRow isLast={true} message={msg} />)

		expect(screen.getByText("Cancelled", { exact: true })).toBeInTheDocument()
		expect(screen.queryByText("Running in background", { exact: true })).not.toBeInTheDocument()
	})

	it("offers Continue in Background for an eligible foreground subagent", async () => {
		taskActivities.push({
			activityId: "job-foreground",
			taskId: "task-1",
			kind: "subagent",
			executionMode: "foreground",
			status: "running",
			cancellable: true,
			createdAt: 1,
			updatedAt: 1,
			title: "reviewer",
		})
		const msg = makeMsg({
			say: "subagent",
			text: JSON.stringify({
				status: "running",
				items: [
					{
						index: 1,
						jobId: "job-foreground",
						prompt: "review",
						status: "running",
						background: false,
						backgroundHandoffAvailable: true,
						toolCalls: 0,
						inputTokens: 0,
						outputTokens: 0,
						totalCost: 0,
						currency: "USD",
						contextTokens: 0,
						contextWindow: 0,
						contextUsagePercentage: 0,
					},
				],
			}),
		})

		render(<SubagentStatusRow isLast={true} message={msg} />)
		fireEvent.click(screen.getByRole("button", { name: "Continue in Background" }))

		await waitFor(() => expect(moveSubagentToBackground).toHaveBeenCalledWith("task-1", "job-foreground"))
		expect(screen.getByTestId("subagent-execution-mode")).toHaveTextContent("Foreground")
	})

	it("cancels only canonical cancellable activities in a batch", () => {
		taskActivities.push(
			{
				activityId: "job-1",
				taskId: "task-1",
				kind: "subagent",
				executionMode: "background",
				status: "running",
				cancellable: true,
				createdAt: 1,
				updatedAt: 1,
				title: "reviewer 1",
			},
			{
				activityId: "job-2",
				taskId: "task-1",
				kind: "subagent",
				executionMode: "background",
				status: "running",
				cancellable: false,
				createdAt: 2,
				updatedAt: 2,
				title: "reviewer 2",
			},
			{
				activityId: "job-3",
				taskId: "task-1",
				kind: "subagent",
				executionMode: "background",
				status: "running",
				cancellable: true,
				createdAt: 3,
				updatedAt: 3,
				title: "reviewer 3",
			},
		)
		const items = ["job-1", "job-2", "job-3"].map((jobId, index) => ({
			index: index + 1,
			jobId,
			prompt: `review ${index + 1}`,
			status: "running",
			toolCalls: 0,
			inputTokens: 0,
			outputTokens: 0,
			totalCost: 0,
			currency: "USD",
			contextTokens: 0,
			contextWindow: 0,
			contextUsagePercentage: 0,
		}))
		const msg = makeMsg({
			say: "subagent",
			text: JSON.stringify({ status: "running", items }),
		})

		render(<SubagentStatusRow isLast={true} message={msg} />)
		expect(screen.getByRole("button", { name: "Cancel all" })).toHaveClass("h-5")
		fireEvent.click(screen.getByRole("button", { name: "Cancel all" }))

		const cancelButtons = screen.getAllByRole("button", { name: "Cancel" })
		expect(cancelButtons).toHaveLength(2)
		for (const button of cancelButtons) expect(button).toHaveClass("h-5")
		expect(cancelTaskActivities).toHaveBeenCalledWith("task-1", ["job-1", "job-3"])
	})

	it("renders the subagent name, sequence, bounded task, and single-line context without exposing the job id", () => {
		const jobId = "subagent_batch_fg_call_AvllKHRBjVSaDfW6gFJJVvhL_1"
		const msg = makeMsg({
			say: "subagent",
			text: JSON.stringify({
				status: "running",
				items: [
					{
						index: 1,
						jobId,
						prompt: "<task>review code</task><context>focus on cancellation</context>",
						subagentName: "reviewer",
						task: "review code",
						context: "focus on cancellation\nthen verify cleanup",
						status: "running",
						toolCalls: 0,
						inputTokens: 0,
						outputTokens: 0,
						totalCost: 0,
						currency: "USD",
						contextTokens: 0,
						contextWindow: 0,
						contextUsagePercentage: 0,
					},
				],
			}),
		})

		render(<SubagentStatusRow isLast={true} message={msg} />)

		const item = screen.getByTestId("subagent-item")
		const name = screen.getByTestId("subagent-name")
		const task = screen.getByRole("heading", { name: "review code" })
		const context = screen.getByTestId("subagent-context")
		const contextContent = screen.getByTestId("subagent-context-content")
		expect(name).toHaveTextContent("reviewer")
		expect(screen.getAllByText("reviewer")).toHaveLength(1)
		expect(task.parentElement).toHaveClass("max-h-[72px]", "overflow-y-auto")
		expect(context).toHaveClass("h-5")
		expect(context).toHaveTextContent("Context")
		expect(contextContent).toHaveClass("truncate")
		expect(contextContent).toHaveAttribute("title", "focus on cancellation\nthen verify cleanup")
		expect(screen.queryByRole("button", { name: /subagent context/i })).not.toBeInTheDocument()
		expect(screen.getByTestId("subagent-execution-mode")).toHaveTextContent("Foreground")
		expect(item).toHaveTextContent("#1")
		expect(item).not.toHaveTextContent(jobId)
		expect(item.parentElement).not.toHaveClass("overflow-y-auto")
		expect(screen.queryByText(/<task>/)).not.toBeInTheDocument()
		expect(screen.queryByText(/<context>/)).not.toBeInTheDocument()
	})

	it("renders each activity tool call once in execution order", () => {
		taskActivities.push({
			activityId: "job-tools",
			taskId: "task-1",
			kind: "subagent",
			executionMode: "foreground",
			status: "completed",
			cancellable: false,
			createdAt: 1,
			updatedAt: 2,
			title: "reviewer",
			events: [
				{
					sequence: 4,
					timestamp: 4,
					kind: "tool_call",
					toolCallId: "second",
					toolName: "list_files",
					toolStatus: "completed",
					summary: "list_files(path=.)",
				},
				{
					sequence: 1,
					timestamp: 1,
					kind: "tool_call",
					toolCallId: "first",
					toolName: "read_file",
					toolStatus: "started",
					summary: "read_file(path=README.md)",
				},
				{
					sequence: 3,
					timestamp: 3,
					kind: "tool_call",
					toolCallId: "first",
					toolName: "read_file",
					toolStatus: "completed",
					summary: "read_file(path=README.md)",
				},
			],
		})
		const msg = makeMsg({
			say: "subagent",
			text: JSON.stringify({
				status: "completed",
				items: [
					{
						index: 1,
						jobId: "job-tools",
						prompt: "review",
						status: "completed",
						toolCalls: 2,
						inputTokens: 0,
						outputTokens: 0,
						totalCost: 0,
						currency: "USD",
						contextTokens: 0,
						contextWindow: 0,
						contextUsagePercentage: 0,
					},
				],
			}),
		})

		render(<SubagentStatusRow isLast={true} message={msg} />)

		const toolCalls = screen.getAllByTestId("subagent-tool-call")
		expect(toolCalls.map((row) => row.textContent)).toEqual(["1.read_file(path=README.md)", "2.list_files(path=.)"])
		expect(screen.getByText("Tools").parentElement).toHaveClass("max-h-[96px]", "overflow-y-auto")
	})

	it("bounds expanded subagent output inside the individual item", () => {
		const msg = makeMsg({
			say: "subagent",
			text: JSON.stringify({
				status: "completed",
				items: [
					{
						index: 1,
						prompt: "review",
						status: "completed",
						result: "long result",
						toolCalls: 1,
						inputTokens: 10,
						outputTokens: 5,
						totalCost: 0,
						currency: "USD",
						contextTokens: 15,
						contextWindow: 200000,
						contextUsagePercentage: 0.01,
					},
				],
			}),
		})

		render(<SubagentStatusRow isLast={true} message={msg} />)
		fireEvent.click(screen.getByRole("button", { name: "Show subagent output" }))

		expect(screen.getByTestId("subagent-output").parentElement).toHaveClass("max-h-[240px]", "overflow-y-auto")
	})
})
