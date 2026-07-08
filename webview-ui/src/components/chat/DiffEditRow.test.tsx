import { act, fireEvent, render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { DiffEditRow } from "./DiffEditRow"

vi.mock("@/components/common/CodeAccordian", () => ({
	default: ({ code }: { code: string }) => <pre>{code}</pre>,
}))

vi.mock("@/lib/utils", () => ({
	cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" "),
}))

vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: {
		openFileRelativePath: vi.fn(),
	},
}))

/**
 * Build a streaming diff patch with deterministic line content.
 *
 * @param lineCount Number of added lines to include.
 * @returns Patch text rendered by DiffEditRow.
 */
function buildPatch(lineCount: number): string {
	return Array.from({ length: lineCount }, (_, index) => `+ streamed line ${index + 1}`).join("\n")
}

/**
 * Find the internal scroll container used by a rendered diff file block.
 *
 * @param root Rendered test root element.
 * @returns Internal diff scroll container element.
 */
function findScrollBox(root: HTMLElement): HTMLElement {
	const element = root.querySelector(".max-h-80.overflow-y-auto")
	if (!(element instanceof HTMLElement)) {
		throw new Error("Diff scroll container was not rendered")
	}
	return element
}

/**
 * Override jsdom layout metrics for a scroll container.
 *
 * @param element Scroll container element.
 * @param scrollHeight Full content height.
 * @param clientHeight Visible viewport height.
 */
function setScrollMetrics(element: HTMLElement, scrollHeight: number, clientHeight: number): void {
	Object.defineProperty(element, "scrollHeight", { configurable: true, value: scrollHeight })
	Object.defineProperty(element, "clientHeight", { configurable: true, value: clientHeight })
}

describe("DiffEditRow", () => {
	it("keeps streaming diff content scrolled to the latest line", async () => {
		const { container, rerender } = render(
			<DiffEditRow fileAction="Update" isLoading={true} patch={buildPatch(6)} path="src/example.ts" />,
		)
		const scrollBox = findScrollBox(container)
		setScrollMetrics(scrollBox, 600, 200)
		scrollBox.scrollTop = 0

		await act(async () => {
			rerender(<DiffEditRow fileAction="Update" isLoading={true} patch={buildPatch(12)} path="src/example.ts" />)
		})

		expect(scrollBox.scrollTop).toBe(400)
	})

	it("does not force streaming diff content back to bottom after manual scroll up", async () => {
		const { container, rerender } = render(
			<DiffEditRow fileAction="Update" isLoading={true} patch={buildPatch(6)} path="src/example.ts" />,
		)
		const scrollBox = findScrollBox(container)
		setScrollMetrics(scrollBox, 600, 200)
		scrollBox.scrollTop = 100

		await act(async () => {
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
		})
		fireEvent.scroll(scrollBox)

		await act(async () => {
			rerender(<DiffEditRow fileAction="Update" isLoading={true} patch={buildPatch(12)} path="src/example.ts" />)
		})

		expect(scrollBox.scrollTop).toBe(100)
	})
})
