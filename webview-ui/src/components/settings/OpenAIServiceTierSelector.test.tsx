// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import React from "react"
import { describe, expect, it, vi } from "vitest"
import OpenAIServiceTierSelector from "./OpenAIServiceTierSelector"

vi.mock("@/components/ui/label", () => ({
	Label: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock("@/components/ui/select", () => ({
	Select: ({
		children,
		onValueChange,
		value,
	}: {
		children: React.ReactNode
		onValueChange: (value: string) => void
		value: string
	}) => (
		<div data-testid="service-tier" data-value={value}>
			{children}
			<button onClick={() => onValueChange("priority")} type="button">
				Choose Priority
			</button>
			<button onClick={() => onValueChange("provider-default")} type="button">
				Choose Provider Default
			</button>
		</div>
	),
	SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectValue: () => <span />,
}))

describe("OpenAIServiceTierSelector", () => {
	it("selects an explicit tier and can restore provider default", () => {
		const onServiceTierChange = vi.fn()
		const { rerender } = render(<OpenAIServiceTierSelector onServiceTierChange={onServiceTierChange} />)

		expect(screen.getByTestId("service-tier")).toHaveAttribute("data-value", "provider-default")
		fireEvent.click(screen.getByRole("button", { name: "Choose Priority" }))
		expect(onServiceTierChange).toHaveBeenLastCalledWith("priority")

		rerender(<OpenAIServiceTierSelector onServiceTierChange={onServiceTierChange} serviceTier="priority" />)
		expect(screen.getByTestId("service-tier")).toHaveAttribute("data-value", "priority")
		fireEvent.click(screen.getByRole("button", { name: "Choose Provider Default" }))
		expect(onServiceTierChange).toHaveBeenLastCalledWith(undefined)
	})
})
