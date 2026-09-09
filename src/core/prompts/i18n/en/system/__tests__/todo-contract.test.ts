import { describe, expect, it } from "vitest"
import makePlan from "../../tools/makePlan"
import contextManagement from "../contextManagement"
import focusChain from "../focusChain"
import taskProgress from "../taskProgress"

describe("TODO and Focus Chain prompt contract", () => {
	it("does not restate the already-active TODO tracking condition", () => {
		expect(focusChain.main).not.toContain("When TODO tracking is enabled")
		expect(focusChain.main).toContain("Tools that expose `task_progress` can create or update the TODO list")
	})

	it("describes summarize_task task_progress as an ordered incremental continuation", () => {
		const instruction = contextManagement.summarizeFocusChainParam

		expect(instruction).toContain("exact completed items that represent the current progress")
		expect(instruction).toContain("subsequent items that still need to be completed")
		expect(instruction).toContain("The first `- [ ]` item identifies the current work")
		expect(instruction).toContain("Do not send the full checklist, title, or section headings")
		expect(instruction).not.toContain("Only report COMPLETED items")
	})

	it("uses distinct ordered items in the summarize_task example", () => {
		const example = contextManagement.summarizeFocusChainExample
		const items = example
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.startsWith("- ["))

		expect(items).toEqual([
			"- [x] Trace refresh-token failure",
			"- [x] Correct refresh retry state",
			"- [ ] Verify expired-session recovery",
			"- [ ] Verify explicit logout behavior",
		])
		expect(new Set(items).size).toBe(items.length)
		expect(example).not.toContain("# ")
		expect(example).not.toContain("## ")
	})

	it("allows an exact unchecked current item to be reported by itself", () => {
		expect(focusChain.reminder).toContain("one existing `- [ ]` item by itself")
		expect(taskProgress.standardFused).toContain("either by itself to identify the current work")
		expect(taskProgress.paramInstruction).toContain("the current item may be sent by itself")
		expect(focusChain.reminder).not.toContain("alongside completed items")
	})

	it("keeps Section headings optional when creating a complete checklist", () => {
		expect(focusChain.initial).toContain("optional `## Section` headings")
		expect(focusChain.completed).toContain("optional `## Section` headings")
		expect(taskProgress.standardFused).toContain("optional `## Section` headings")
		expect(makePlan.description).toContain("a required # Title and optional ## Section headings")
		expect(makePlan.focusOmissionDescriptionClause).toContain("a required # Title and optional ## Section headings")
	})

	it("keeps strict order instructions without advertising runtime tolerance", () => {
		expect(focusChain.reminder).toContain("Complete items in strict order")
		expect(focusChain.main).toContain("Complete items in strict order")
		expect(taskProgress.standardFused).toContain("Complete items in strict order")
		expect(focusChain.reminder).not.toContain("first offense")
		expect(focusChain.main).not.toContain("first offense")
		expect(taskProgress.standardFused).not.toContain("first offense")
	})
})
