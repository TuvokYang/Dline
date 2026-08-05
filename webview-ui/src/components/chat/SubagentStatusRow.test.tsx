// @vitest-environment jsdom

import type { ClineMessage } from "@shared/ExtensionMessage"
import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import SubagentStatusRow from "./SubagentStatusRow"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ currentTaskItem: { id: "task-1" } }),
}))

const { cancelTaskActivities, taskActivities } = vi.hoisted(() => ({
	cancelTaskActivities: vi.fn(),
	taskActivities: [] as Array<Record<string, unknown>>,
}))

vi.mock("./activity/useTaskActivities", () => ({
	cancelTaskActivities: (...args: unknown[]) => cancelTaskActivities(...args),
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
		fireEvent.click(screen.getByRole("button", { name: "Cancel all" }))

		expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(2)
		expect(cancelTaskActivities).toHaveBeenCalledWith("task-1", ["job-1", "job-3"])
	})

	it("renders task prominently and expands context from one line", () => {
		const msg = makeMsg({
			say: "subagent",
			text: JSON.stringify({
				status: "running",
				items: [
					{
						index: 1,
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

		expect(screen.getByText("reviewer")).toBeInTheDocument()
		expect(screen.getByRole("heading", { name: "review code" })).toBeInTheDocument()
		const context = screen.getByRole("button", { name: "Show full subagent context" })
		expect(context).toHaveAttribute("aria-expanded", "false")
		expect(screen.getByTestId("subagent-context-content")).toHaveClass("h-4", "overflow-hidden")
		fireEvent.click(context)
		expect(screen.getByRole("button", { name: "Collapse subagent context" })).toHaveAttribute("aria-expanded", "true")
		expect(screen.getByText(/then verify cleanup/)).toBeInTheDocument()
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

		expect(screen.getAllByTestId("subagent-tool-call").map((row) => row.textContent)).toEqual([
			"1.read_file(path=README.md)",
			"2.list_files(path=.)",
		])
	})
})
