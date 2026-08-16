import type { ContextWindowIndicatorSnapshot } from "@shared/context-window-indicator"
import { act, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import ContextWindowSegmentedProgress from "./ContextWindowSegmentedProgress"

function snapshot(overrides: Partial<ContextWindowIndicatorSnapshot> = {}): ContextWindowIndicatorSnapshot {
	return {
		taskId: "task-1",
		revision: 1,
		epoch: 1,
		phase: "receiving",
		durableContextTokens: 40_000,
		pendingSendTokens: 20_000,
		receivingTokens: 10_000,
		environmentTokens: 5_000,
		contextWindow: 100_000,
		mode: "act",
		updatedAt: 1,
		lineage: { kind: "baseline" },
		...overrides,
	}
}

describe("ContextWindowSegmentedProgress", () => {
	it("renders four colored segments in durable, sending, receiving, ENV order", () => {
		render(<ContextWindowSegmentedProgress snapshot={snapshot()} />)

		const progress = screen.getByRole("progressbar", { name: "Context window usage progress" })
		const segments = [
			screen.getByTestId("context-window-segment-durable"),
			screen.getByTestId("context-window-segment-sending"),
			screen.getByTestId("context-window-segment-receiving"),
			screen.getByTestId("context-window-segment-environment"),
		]

		expect(progress).toHaveAttribute("data-phase", "receiving")
		expect(
			Array.from(progress.querySelectorAll("[data-segment]")).map((element) => element.getAttribute("data-segment")),
		).toEqual(["durable", "sending", "receiving", "environment"])
		expect(segments.map((segment) => segment.getAttribute("data-tokens"))).toEqual(["40000", "20000", "10000", "5000"])
		// Durable keeps its authoritative width while the minor group is visually amplified.
		expect(segments[0].style.width).toBe("40%")
		const minorWidths = segments.slice(1).map((segment) => Number.parseFloat(segment.style.width))
		expect(minorWidths.every((width) => Number.isFinite(width) && width > 0)).toBe(true)
		// Internal minor-group token ratio (20k : 10k : 5k = 4 : 2 : 1) is preserved.
		expect(minorWidths[0] / minorWidths[1]).toBeCloseTo(2, 1)
		expect(minorWidths[1] / minorWidths[2]).toBeCloseTo(2, 1)
		// Every non-zero minor segment stays visually recognizable on the bar.
		expect(minorWidths.every((width) => width >= 0.75)).toBe(true)
		expect(segments.map((segment) => segment.style.backgroundColor)).toEqual([
			"var(--vscode-charts-green, #3fb950)",
			"var(--vscode-charts-blue, #58a6ff)",
			"var(--vscode-charts-yellow, #d29922)",
			"var(--vscode-charts-purple, #bc8cff)",
		])
		expect(segments[2]).toHaveAttribute("data-active", "true")
		expect(segments[2]).toHaveClass("animate-pulse")
		expect(segments[3]).toHaveAttribute("title", "ENV: 5000 tokens")
		expect(segments.map((segment) => segment.getAttribute("tabindex"))).toEqual(["0", "0", "0", "0"])
		expect(segments.map((segment) => segment.getAttribute("aria-label"))).toEqual([
			"Durable: 40000 tokens",
			"Sending: 20000 tokens",
			"Receiving: 10000 tokens",
			"ENV: 5000 tokens",
		])
	})

	it("retains the previous temporary segments while an authoritative commit clears them", () => {
		const { rerender } = render(<ContextWindowSegmentedProgress snapshot={snapshot()} />)

		rerender(
			<ContextWindowSegmentedProgress
				snapshot={snapshot({
					revision: 2,
					phase: "committing",
					durableContextTokens: 68_000,
					pendingSendTokens: 0,
					receivingTokens: 0,
					lineage: {
						kind: "checkpoint",
						operationId: "operation-1",
						checkpointId: "checkpoint-1",
						chainRevision: 1,
						branchId: "branch-1",
					},
				})}
			/>,
		)

		expect(screen.getByTestId("context-window-segmented-progress")).toHaveAttribute("data-motion", "commit")
		expect(screen.getByTestId("context-window-segment-durable").style.filter).toBe("brightness(1.16)")
		for (const [kind, previousTokens] of [
			["sending", "20000"],
			["receiving", "10000"],
		] as const) {
			const segment = screen.getByTestId(`context-window-segment-${kind}`)
			expect(segment).toHaveAttribute("data-authoritative-tokens", "0")
			expect(segment).toHaveAttribute("data-tokens", previousTokens)
			expect(segment).toHaveAttribute("data-transition-source", "previous")
			expect(segment.style.width).toBe("0%")
			expect(segment.style.opacity).toBe("0")
			expect(segment.style.transform).toBe("translateX(-8px)")
		}

		rerender(
			<ContextWindowSegmentedProgress
				snapshot={snapshot({
					revision: 3,
					phase: "stable",
					durableContextTokens: 68_000,
					pendingSendTokens: 0,
					receivingTokens: 0,
					lineage: {
						kind: "checkpoint",
						operationId: "operation-1",
						checkpointId: "checkpoint-1",
						chainRevision: 1,
						branchId: "branch-1",
					},
				})}
			/>,
		)
		expect(screen.getByTestId("context-window-segmented-progress")).toHaveAttribute("data-motion", "commit")
		expect(screen.getByTestId("context-window-segment-receiving")).toHaveAttribute("data-tokens", "10000")
	})

	it("infers coalesced commit from the epoch even when the durable total is unchanged", () => {
		const { rerender } = render(<ContextWindowSegmentedProgress snapshot={snapshot()} />)

		rerender(
			<ContextWindowSegmentedProgress
				snapshot={snapshot({
					revision: 2,
					epoch: 1,
					phase: "stable",
					durableContextTokens: 40_000,
					pendingSendTokens: 0,
					receivingTokens: 0,
					lineage: {
						kind: "checkpoint",
						operationId: "operation-1",
						checkpointId: "checkpoint-1",
						chainRevision: 1,
						branchId: "branch-1",
					},
				})}
			/>,
		)

		expect(screen.getByTestId("context-window-segmented-progress")).toHaveAttribute("data-motion", "commit")
	})

	it("infers a coalesced rollback only when the epoch advances", () => {
		const { rerender } = render(<ContextWindowSegmentedProgress snapshot={snapshot()} />)

		rerender(
			<ContextWindowSegmentedProgress
				snapshot={snapshot({
					revision: 2,
					epoch: 2,
					phase: "stable",
					durableContextTokens: 40_000,
					pendingSendTokens: 0,
					receivingTokens: 0,
				})}
			/>,
		)

		expect(screen.getByTestId("context-window-segmented-progress")).toHaveAttribute("data-motion", "rollback")
	})

	it("clears retained commit motion after the animation settle window", () => {
		vi.useFakeTimers()
		try {
			const { rerender } = render(<ContextWindowSegmentedProgress snapshot={snapshot()} />)
			rerender(
				<ContextWindowSegmentedProgress
					snapshot={snapshot({
						revision: 2,
						phase: "committing",
						durableContextTokens: 68_000,
						pendingSendTokens: 0,
						receivingTokens: 0,
					})}
				/>,
			)
			rerender(
				<ContextWindowSegmentedProgress
					snapshot={snapshot({
						revision: 3,
						phase: "stable",
						durableContextTokens: 68_000,
						pendingSendTokens: 0,
						receivingTokens: 0,
					})}
				/>,
			)
			expect(screen.getByTestId("context-window-segmented-progress")).toHaveAttribute("data-motion", "commit")

			act(() => vi.advanceTimersByTime(720))

			expect(screen.getByTestId("context-window-segmented-progress")).toHaveAttribute("data-motion", "none")
			expect(screen.getByTestId("context-window-segment-receiving")).toHaveAttribute("data-tokens", "0")
		} finally {
			vi.useRealTimers()
		}
	})

	it("animates temporary segments outward during rollback and restore", () => {
		const { rerender } = render(<ContextWindowSegmentedProgress snapshot={snapshot()} />)

		rerender(
			<ContextWindowSegmentedProgress
				snapshot={snapshot({
					revision: 2,
					phase: "rolling_back",
					durableContextTokens: 40_000,
					pendingSendTokens: 0,
					receivingTokens: 0,
				})}
			/>,
		)
		expect(screen.getByTestId("context-window-segmented-progress")).toHaveAttribute("data-motion", "rollback")
		expect(screen.getByTestId("context-window-segment-sending")).toHaveAttribute("data-tokens", "20000")
		expect(screen.getByTestId("context-window-segment-sending").style.transform).toBe("translateX(8px)")

		rerender(
			<ContextWindowSegmentedProgress
				snapshot={snapshot({
					revision: 3,
					phase: "restoring",
					durableContextTokens: 75_000,
					pendingSendTokens: 0,
					receivingTokens: 0,
					lineage: {
						kind: "restore",
						operationId: "operation-1",
						journalId: "journal-1",
						targetCheckpointId: "checkpoint-0",
						headCheckpointId: "checkpoint-0",
						chainRevision: 2,
						branchId: "branch-2",
					},
				})}
			/>,
		)
		expect(screen.getByTestId("context-window-segmented-progress")).toHaveAttribute("data-motion", "restore")
	})

	it("preserves restore motion when the restoring phase is coalesced into a stable snapshot", () => {
		const { rerender } = render(
			<ContextWindowSegmentedProgress snapshot={snapshot({ phase: "stable", pendingSendTokens: 0, receivingTokens: 0 })} />,
		)

		rerender(
			<ContextWindowSegmentedProgress
				snapshot={snapshot({
					revision: 2,
					phase: "stable",
					durableContextTokens: 75_000,
					pendingSendTokens: 0,
					receivingTokens: 0,
					lineage: {
						kind: "restore",
						operationId: "operation-1",
						journalId: "journal-1",
						targetCheckpointId: "checkpoint-0",
						headCheckpointId: "checkpoint-0",
						chainRevision: 2,
						branchId: "branch-2",
					},
				})}
			/>,
		)

		expect(screen.getByTestId("context-window-segmented-progress")).toHaveAttribute("data-motion", "restore")
	})

	it("provides reduced-motion fallbacks for every animated segment", () => {
		render(<ContextWindowSegmentedProgress snapshot={snapshot()} />)

		for (const kind of ["durable", "sending", "receiving", "environment"] as const) {
			expect(screen.getByTestId(`context-window-segment-${kind}`)).toHaveClass(
				"motion-reduce:transition-none",
				"motion-reduce:transform-none",
			)
		}
		expect(screen.getByTestId("context-window-segment-receiving")).toHaveClass("motion-reduce:animate-none")
	})

	it("caps the shared minor-group factor when receiving starts with one token", () => {
		render(
			<ContextWindowSegmentedProgress
				snapshot={snapshot({
					contextWindow: 1_000_000,
					durableContextTokens: 10_000,
					pendingSendTokens: 2_000,
					receivingTokens: 1,
					environmentTokens: 1_000,
				})}
			/>,
		)

		const progress = screen.getByTestId("context-window-segmented-progress")
		expect(Number(progress.getAttribute("data-minor-factor"))).toBeLessThanOrEqual(3)
		const totalWidth = ["durable", "sending", "receiving", "environment"].reduce(
			(total, kind) => total + Number.parseFloat(screen.getByTestId(`context-window-segment-${kind}`).style.width),
			0,
		)
		expect(totalWidth).toBeLessThan(5)
	})

	it("amplifies sub-pixel minor segments into visible widths with one common factor", () => {
		render(
			<ContextWindowSegmentedProgress
				snapshot={snapshot({
					contextWindow: 1_000_000,
					durableContextTokens: 10_000,
					pendingSendTokens: 2_000,
					receivingTokens: 1_000,
					environmentTokens: 1_000,
				})}
			/>,
		)

		expect(screen.getByTestId("context-window-segmented-progress")).toHaveAttribute("data-minor-factor", "3")
		expect(screen.getByTestId("context-window-segment-durable").style.width).toBe("1%")
		expect(screen.getByTestId("context-window-segment-sending").style.width).toBe("0.6%")
		expect(screen.getByTestId("context-window-segment-receiving").style.width).toBe("0.3%")
		expect(screen.getByTestId("context-window-segment-environment").style.width).toBe("0.3%")

		const sending = screen.getByTestId("context-window-segment-sending")
		expect(sending).toHaveAttribute("data-authoritative-tokens", "2000")
		expect(sending).toHaveAttribute("data-tokens", "2000")
		expect(screen.getByTestId("context-window-segment-environment")).toHaveAttribute("data-tokens", "1000")

		const minorRatio =
			Number.parseFloat(sending.style.width) /
			Number.parseFloat(screen.getByTestId("context-window-segment-receiving").style.width)
		expect(minorRatio).toBeCloseTo(2, 1)
	})

	it("updates the ENV segment when the backend publishes a freshly recomputed environment", () => {
		const { rerender } = render(
			<ContextWindowSegmentedProgress
				snapshot={snapshot({ phase: "stable", pendingSendTokens: 0, receivingTokens: 0, environmentTokens: 5_000 })}
			/>,
		)

		const envBefore = screen.getByTestId("context-window-segment-environment")
		expect(envBefore).toHaveAttribute("data-tokens", "5000")

		rerender(
			<ContextWindowSegmentedProgress
				snapshot={snapshot({
					revision: 2,
					phase: "stable",
					pendingSendTokens: 0,
					receivingTokens: 0,
					environmentTokens: 9_000,
				})}
			/>,
		)

		const envAfter = screen.getByTestId("context-window-segment-environment")
		expect(envAfter).toHaveAttribute("data-tokens", "9000")
		expect(envAfter).toHaveAttribute("data-authoritative-tokens", "9000")
		expect(envAfter.style.width).toBe("27%")
	})

	it("keeps ENV separate and applies the bounded shared factor after a round completes", () => {
		render(
			<ContextWindowSegmentedProgress
				snapshot={snapshot({
					phase: "stable",
					durableContextTokens: 500,
					pendingSendTokens: 0,
					receivingTokens: 0,
					environmentTokens: 50,
				})}
			/>,
		)

		const durable = screen.getByTestId("context-window-segment-durable")
		const env = screen.getByTestId("context-window-segment-environment")
		expect(durable).toHaveAttribute("data-authoritative-tokens", "500")
		expect(env).toHaveAttribute("data-authoritative-tokens", "50")
		expect(env.style.width).toBe("0.15%")
	})

	it("caps the minor-group amplification so the bar never overflows when durable fills the window", () => {
		render(
			<ContextWindowSegmentedProgress
				snapshot={snapshot({
					durableContextTokens: 99_500,
					pendingSendTokens: 0,
					receivingTokens: 0,
					environmentTokens: 500,
				})}
			/>,
		)

		expect(screen.getByTestId("context-window-segmented-progress")).toHaveAttribute("data-minor-factor", "1")
		expect(screen.getByTestId("context-window-segment-durable").style.width).toBe("99.5%")
		expect(screen.getByTestId("context-window-segment-environment").style.width).toBe("0.5%")
		const totalWidth =
			Number.parseFloat(screen.getByTestId("context-window-segment-durable").style.width) +
			Number.parseFloat(screen.getByTestId("context-window-segment-environment").style.width)
		expect(totalWidth).toBeLessThanOrEqual(100)
	})
})
