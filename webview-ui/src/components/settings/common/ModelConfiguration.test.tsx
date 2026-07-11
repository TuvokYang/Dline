// @vitest-environment jsdom
import type { ModelInfo } from "@shared/proto/dline/models"
import type { ModelCapabilities, ModelPricing } from "@shared/proto/dline/models/metadata"
import { fireEvent, render, screen } from "@testing-library/react"
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { ModelConfiguration } from "./ModelConfiguration"

vi.mock("@/components/ui/label", () => ({
	Label: ({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) => (
		<div className={className} style={style}>
			{children}
		</div>
	),
}))

vi.mock("@/components/ui/select", () => ({
	Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	SelectValue: () => <span />,
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({
		children,
		onClick,
	}: {
		children: React.ReactNode
		onClick?: React.MouseEventHandler<HTMLButtonElement>
	}) => (
		<button onClick={onClick} type="button">
			{children}
		</button>
	),
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
	it("keeps checkbox draft state while persisted props are stale", () => {
		const onCapabilitiesUpdate = vi.fn()
		const { rerender } = render(
			<ModelConfiguration
				capabilities={{ supportsImages: false } as ModelCapabilities}
				fields={{ capabilities: ["supportsImages"] }}
				onCapabilitiesUpdate={onCapabilitiesUpdate}
				onPricingUpdate={vi.fn()}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: /Model Configuration/i }))
		fireEvent.click(screen.getByLabelText("Supports Images"))
		expect(screen.getByLabelText("Supports Images")).toBeChecked()

		rerender(
			<ModelConfiguration
				capabilities={{ supportsImages: false } as ModelCapabilities}
				fields={{ capabilities: ["supportsImages"] }}
				onCapabilitiesUpdate={onCapabilitiesUpdate}
				onPricingUpdate={vi.fn()}
			/>,
		)
		expect(screen.getByLabelText("Supports Images")).toBeChecked()
	})

	it("adds and edits custom context and pricing tiers", () => {
		const onCapabilitiesUpdate = vi.fn()
		const onPricingUpdate = vi.fn()

		render(
			<ModelConfiguration
				capabilities={{ contextWindowTiers: [] } as unknown as ModelCapabilities}
				fields={{ capabilities: ["contextWindowTiers"], pricing: ["pricingTiers"] }}
				onCapabilitiesUpdate={onCapabilitiesUpdate}
				onPricingUpdate={onPricingUpdate}
				pricing={{ tiers: [] } as unknown as ModelPricing}
				tiersEditable={true}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: /Model Configuration/i }))
		fireEvent.click(screen.getByRole("button", { name: "Add Context Tier" }))
		expect(onCapabilitiesUpdate).toHaveBeenCalledWith({
			contextWindowTiers: [{ id: "standard", contextWindow: 128_000, label: "128K", apiModelSuffix: "" }],
		})

		fireEvent.change(screen.getByLabelText("Context Tier ID"), { target: { value: "long" } })
		expect(onCapabilitiesUpdate).toHaveBeenLastCalledWith({
			contextWindowTiers: [{ id: "long", contextWindow: 128_000, label: "128K", apiModelSuffix: "" }],
		})

		fireEvent.click(screen.getByRole("button", { name: "Add Pricing Tier" }))
		expect(onPricingUpdate).toHaveBeenCalledWith({
			tiers: [{ contextWindow: 128_000, inputPrice: 0, outputPrice: 0, cacheWritesPrice: 0, cacheReadsPrice: 0 }],
		})
	})

	it("renders official tiers without add or remove controls", () => {
		render(
			<ModelConfiguration
				capabilities={
					{
						contextWindowTiers: [{ id: "standard", contextWindow: 272_000, label: "272K" }],
					} as unknown as ModelCapabilities
				}
				fields={{ capabilities: ["contextWindowTiers"] }}
				onCapabilitiesUpdate={vi.fn()}
				onPricingUpdate={vi.fn()}
				tiersEditable={false}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: /Model Configuration/i }))
		expect(screen.getByText("standard")).toBeTruthy()
		expect(screen.queryByRole("button", { name: "Add Context Tier" })).toBeNull()
		expect(screen.queryByRole("button", { name: "Remove Context Tier" })).toBeNull()
	})

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

	it("places options with temperature before capabilities and pricing", () => {
		render(
			<ModelConfiguration
				capabilities={{ supportsPromptCache: true, temperature: 0.2 } as ModelCapabilities}
				fields={{
					capabilities: ["supportsImages", "supportsPromptCache", "temperature", "contextWindow", "maxTokens"],
					pricing: ["inputPrice", "outputPrice"],
				}}
				onCapabilitiesUpdate={vi.fn()}
				onPricingUpdate={vi.fn()}
				pricing={{ inputPrice: 1, outputPrice: 2 } as ModelPricing}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: /Model Configuration/i }))

		const options = screen.getByText("Options")
		const temperature = screen.getByLabelText("Temperature")
		const capabilities = screen.getByText("Capabilities")
		const contextWindow = screen.getByLabelText("Context Window Size")
		const maxOutput = screen.getByLabelText("Max Output Tokens")
		const pricing = screen.getByText("Pricing")
		const inputPrice = screen.getByLabelText(/Input Price/)

		expect(options.compareDocumentPosition(temperature)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
		expect(temperature.compareDocumentPosition(capabilities)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
		expect(capabilities.compareDocumentPosition(contextWindow)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
		expect(contextWindow.compareDocumentPosition(maxOutput)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
		expect(maxOutput.compareDocumentPosition(pricing)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
		expect(pricing.compareDocumentPosition(inputPrice)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
	})

	it("hides cache pricing when prompt cache support is disabled", () => {
		render(
			<ModelConfiguration
				capabilities={{ supportsPromptCache: false } as ModelCapabilities}
				fields={{
					capabilities: ["supportsPromptCache"],
					pricing: ["inputPrice", "cacheWritesPrice", "cacheReadsPrice"],
				}}
				onCapabilitiesUpdate={vi.fn()}
				onPricingUpdate={vi.fn()}
				pricing={{ cacheReadsPrice: 0.1, cacheWritesPrice: 0.2, inputPrice: 1 } as ModelPricing}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: /Model Configuration/i }))

		expect(screen.getByLabelText(/Input Price/)).toBeTruthy()
		expect(screen.queryByLabelText(/Cache Writes/)).toBeNull()
		expect(screen.queryByLabelText(/Cache Reads/)).toBeNull()
	})

	it("uses built-in defaults for context and max output", () => {
		render(
			<ModelConfiguration
				fields={{ capabilities: ["contextWindow", "maxTokens"] }}
				onCapabilitiesUpdate={vi.fn()}
				onPricingUpdate={vi.fn()}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: /Model Configuration/i }))

		expect(screen.getByLabelText("Context Window Size")).toHaveValue("128000")
		expect(screen.getByLabelText("Max Output Tokens")).toHaveValue("8192")
	})

	it("lets provider defaults override built-in context and max output", () => {
		const defaults: Partial<ModelInfo> = {
			capabilities: {
				contextWindow: 256_000,
				maxTokens: 16_384,
			} as ModelCapabilities,
		}

		render(
			<ModelConfiguration
				defaults={defaults}
				fields={{ capabilities: ["contextWindow", "maxTokens"] }}
				onCapabilitiesUpdate={vi.fn()}
				onPricingUpdate={vi.fn()}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: /Model Configuration/i }))

		expect(screen.getByLabelText("Context Window Size")).toHaveValue("256000")
		expect(screen.getByLabelText("Max Output Tokens")).toHaveValue("16384")
	})

	it("uses weaker field labels than section titles", () => {
		render(
			<ModelConfiguration
				capabilities={{ contextWindow: 128_000 } as ModelCapabilities}
				fields={{ capabilities: ["contextWindow"] }}
				onCapabilitiesUpdate={vi.fn()}
				onPricingUpdate={vi.fn()}
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: /Model Configuration/i }))

		expect(screen.getByText("Model Configuration")).toHaveStyle({ fontWeight: "700" })
		expect(screen.getByText("Capabilities")).toHaveStyle({ fontWeight: "600" })
		expect(screen.getByText("Context Window Size")).toHaveStyle({ fontWeight: "400" })
		expect(screen.getByText("Context Window Size")).toHaveStyle({ fontSize: "12px" })
	})
})
