// @vitest-environment jsdom

import type { ClineMessage } from "@shared/ExtensionMessage"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import SubagentStatusRow from "./SubagentStatusRow"

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
})
