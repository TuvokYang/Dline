import type { ModelCapabilities, ModelPricing } from "@shared/proto/dline/models/metadata"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ModelConfiguration } from "./ModelConfiguration"

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({
		checked,
		children,
		onChange,
	}: {
		checked?: boolean
		children: React.ReactNode
		onChange?: React.ChangeEventHandler<HTMLInputElement>
	}) => (
		<label>
			<input checked={checked} onChange={onChange} type="checkbox" />
			{children}
		</label>
	),
}))

vi.mock("./DebouncedTextField", () => ({
	DebouncedTextField: ({
		children,
		initialValue,
		onChange,
	}: {
		children?: React.ReactNode
		initialValue?: string
		onChange: (value: string) => void
	}) => (
		<label>
			{children}
			<input defaultValue={initialValue} onChange={(event) => onChange(event.target.value)} />
		</label>
	),
}))

describe("ModelConfiguration", () => {
	it("writes checkbox changes to provider capabilities", () => {
		const onCapabilitiesUpdate = vi.fn()

		render(
			<ModelConfiguration
				capabilities={{ supportsImages: false } as ModelCapabilities}
				fields={{ capabilities: ["supportsImages"] }}
				onCapabilitiesUpdate={onCapabilitiesUpdate}
				onPricingUpdate={vi.fn()}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: /Model Configuration/i }))
		fireEvent.click(screen.getByLabelText("Supports Images"))

		expect(onCapabilitiesUpdate).toHaveBeenCalledWith({ supportsImages: true })
	})

	it("writes temperature changes to provider capabilities", () => {
		const onCapabilitiesUpdate = vi.fn()

		render(
			<ModelConfiguration
				capabilities={{ temperature: 0.1 } as ModelCapabilities}
				fields={{ capabilities: ["temperature"] }}
				onCapabilitiesUpdate={onCapabilitiesUpdate}
				onPricingUpdate={vi.fn()}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: /Model Configuration/i }))
		fireEvent.change(screen.getByLabelText("Temperature"), { target: { value: "0.7" } })

		expect(onCapabilitiesUpdate).toHaveBeenCalledWith({ temperature: 0.7 })
	})

	it("writes pricing changes to provider pricing", () => {
		const onPricingUpdate = vi.fn()

		render(
			<ModelConfiguration
				fields={{ pricing: ["inputPrice"] }}
				onCapabilitiesUpdate={vi.fn()}
				onPricingUpdate={onPricingUpdate}
				pricing={{ inputPrice: 1 } as ModelPricing}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: /Model Configuration/i }))
		fireEvent.change(screen.getByLabelText(/Input Price/), { target: { value: "0.5" } })

		expect(onPricingUpdate).toHaveBeenCalledWith({ inputPrice: 0.5 })
	})
})
