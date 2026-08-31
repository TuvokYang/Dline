// @vitest-environment jsdom

import type { ModelInfo } from "@shared/api"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ModelAutocomplete } from "./ModelAutocomplete"

describe("ModelAutocomplete", () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	it("uses the shared settings field hierarchy and a full-width 28px control", () => {
		render(<ModelAutocomplete label="Model ID" models={{}} onChange={vi.fn()} selectedModelId="custom-model" />)

		const label = screen.getByText("Model ID").closest("label")
		const input = document.getElementById(label?.getAttribute("for") ?? "")
		expect(input).toHaveClass("min-h-7", "w-full")
		expect(screen.getAllByText("Model ID")).toHaveLength(1)
		expect(input?.closest(".profile-field")).toBeInTheDocument()
	})

	it("does not overwrite a clicked suggestion with the stale blur value", async () => {
		vi.useFakeTimers()
		const onChange = vi.fn()
		const models: Record<string, ModelInfo> = {
			"dline-e2e-discovered-model": { id: "dline-e2e-discovered-model" },
		}
		render(<ModelAutocomplete models={models} onChange={onChange} selectedModelId="old-model" />)

		const input = screen.getByRole("combobox")
		fireEvent.focus(input)
		fireEvent.click(screen.getByLabelText("Clear search"))
		const option = screen.getByRole("option", { name: "dline-e2e-discovered-model" })
		fireEvent.mouseDown(option)
		fireEvent.blur(input)
		fireEvent.click(option)
		await act(async () => vi.advanceTimersByTime(200))

		expect(onChange).toHaveBeenCalledWith("dline-e2e-discovered-model", models["dline-e2e-discovered-model"])
		expect(onChange).not.toHaveBeenCalledWith("", undefined)
	})
})
