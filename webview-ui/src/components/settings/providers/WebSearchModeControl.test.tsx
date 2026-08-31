// @vitest-environment jsdom
import { WebSearchMode } from "@shared/proto/dline/provider/common"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { WebSearchModeControl } from "./WebSearchModeControl"

describe("WebSearchModeControl", () => {
	it("defaults legacy profiles to Auto and exposes all four routing modes", () => {
		render(<WebSearchModeControl onChange={vi.fn()} />)

		const control = screen.getByRole("combobox", { name: "Web Search mode" })
		expect(control).toHaveValue(String(WebSearchMode.WEB_SEARCH_MODE_AUTO))
		expect(control).toHaveClass("min-h-7", "w-full", "text-sm")
		expect(screen.getByText("Web Search")).toHaveClass("text-sm", "font-medium")
		expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
			"Auto",
			"Force Local",
			"Off",
			"Force Remote",
		])
	})

	it.each([
		["Auto", WebSearchMode.WEB_SEARCH_MODE_AUTO],
		["Force Local", WebSearchMode.WEB_SEARCH_MODE_FORCE_LOCAL],
		["Off", WebSearchMode.WEB_SEARCH_MODE_FORCE_OFF],
		["Force Remote", WebSearchMode.WEB_SEARCH_MODE_FORCE_REMOTE],
	])("reports %s immediately", (_label, mode) => {
		const onChange = vi.fn()
		render(<WebSearchModeControl onChange={onChange} value={WebSearchMode.WEB_SEARCH_MODE_AUTO} />)

		fireEvent.change(screen.getByRole("combobox", { name: "Web Search mode" }), {
			target: { value: String(mode) },
		})

		expect(onChange).toHaveBeenCalledWith(mode)
	})
})
