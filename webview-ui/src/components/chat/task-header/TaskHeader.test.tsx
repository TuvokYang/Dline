import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import TaskHeader from "./TaskHeader"
import { formatTokenMetric, hasNonZeroModelPricing } from "./util"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		apiConfiguration: {},
		checkpointManagerErrorMessage: undefined,
		currentTaskItem: { id: "task-1" },
		environment: "local",
		expandTaskHeader: false,
		focusChainSettings: { enabled: false },
		mode: "act",
		navigateToSettings: vi.fn(),
		promptCacheHealth: {
			status: "warming",
			sampleCount: 1,
			warmingRound: 1,
			warmingTarget: 3,
			nearContextWindow: false,
		},
		setExpandTaskHeader: vi.fn(),
		taskLockStatus: undefined,
	}),
}))

const task = {
	type: "say" as const,
	say: "task" as const,
	text: "Inspect pricing display",
	ts: 1,
}

describe("TaskHeader pricing", () => {
	it("renders prompt cache health before the task header card", () => {
		const { container } = render(
			<TaskHeader
				doesModelSupportPromptCache={true}
				onClose={vi.fn()}
				task={task}
				tokensIn={0}
				tokensOut={0}
				totalCost={0}
			/>,
		)

		const warming = screen.getByRole("status")
		const taskHeader = screen.getByLabelText("Expand task header").closest("div.relative")
		expect(taskHeader).not.toBeNull()
		expect(warming.compareDocumentPosition(taskHeader as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
		expect(container).toHaveTextContent("Prompt cache warming (1/3)")
	})

	it("renders RPM and TPM before usage metrics in a responsive right-aligned region", () => {
		render(
			<TaskHeader
				activeSeconds={7}
				doesModelSupportPromptCache={false}
				onClose={vi.fn()}
				requestsPerMinute={3}
				task={task}
				tokensIn={1_250}
				tokensOut={250}
				tokensPerMinute={4_500}
				totalCost={0}
			/>,
		)

		const rate = screen.getByTestId("task-rate-metrics")
		const usage = screen.getByTitle("In: 1250 / Out: 250 / Cache read: 0 / Cache write: 0")
		expect(rate).toHaveTextContent("Active:7s")
		expect(rate).toHaveTextContent("RPM:3")
		expect(rate).toHaveTextContent("TPM:4.5K")
		expect(rate).toHaveClass("ml-auto", "justify-end", "@max-sm:hidden")
		expect(rate).toHaveClass("rounded-full", "bg-success/80", "text-background")
		expect(rate).toHaveAttribute("type", "button")
		expect(rate.compareDocumentPosition(usage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
	})

	it("hides a zero-priced model cost while retaining token metrics", () => {
		render(
			<TaskHeader
				doesModelSupportPromptCache={false}
				onClose={vi.fn()}
				pricing={{
					cacheReadsPrice: 0,
					cacheWritesPrice: 0,
					inputPrice: 0,
					outputPrice: 0,
					thinkingOutputPrice: 0,
				}}
				task={task}
				tokensIn={1_250}
				tokensOut={250}
				totalCost={0}
			/>,
		)

		const metrics = screen.getByTitle("In: 1250 / Out: 250 / Cache read: 0 / Cache write: 0")
		expect(metrics).toHaveTextContent("In:1.3K")
		expect(metrics).toHaveTextContent("Out:250")
		expect(screen.queryByText("$0.000")).not.toBeInTheDocument()
	})

	it("keeps the cost visible when the model has non-zero pricing", () => {
		render(
			<TaskHeader
				doesModelSupportPromptCache={false}
				onClose={vi.fn()}
				pricing={{ inputPrice: 0, outputPrice: 1 }}
				task={task}
				tokensIn={0}
				tokensOut={0}
				totalCost={0}
			/>,
		)

		expect(screen.getByText("$0.000")).toBeInTheDocument()
	})

	it("recognizes non-zero cache, context-tier, and thinking-tier prices", () => {
		expect(hasNonZeroModelPricing({ cacheReadsPrice: 0.1 })).toBe(true)
		expect(hasNonZeroModelPricing({ tiers: [{ contextWindow: 128_000, outputPrice: 2 }] })).toBe(true)
		expect(hasNonZeroModelPricing({ thinkingOutputPriceTiers: [{ price: 3, tokenLimit: 8_000 }] })).toBe(true)
	})

	it("promotes billion-scale input and output token metrics from M to B", () => {
		expect(formatTokenMetric(1_000_000_000)).toBe("1.00B")
		expect(formatTokenMetric(1_250_000_000)).toBe("1.25B")

		render(
			<TaskHeader
				doesModelSupportPromptCache={false}
				onClose={vi.fn()}
				pricing={{ inputPrice: 0, outputPrice: 0 }}
				task={task}
				tokensIn={1_000_000_000}
				tokensOut={1_250_000_000}
				totalCost={0}
			/>,
		)

		const metrics = screen.getByTitle("In: 1000000000 / Out: 1250000000 / Cache read: 0 / Cache write: 0")
		expect(metrics).toHaveTextContent("In:1.00B")
		expect(metrics).toHaveTextContent("Out:1.25B")
	})
})
