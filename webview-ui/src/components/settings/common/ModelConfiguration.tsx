import type { ModelInfo } from "@shared/proto/dline/models"
import type { ModelCapabilities, ModelPricing } from "@shared/proto/dline/models/metadata"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DebouncedTextField } from "./DebouncedTextField"

/**
 * Props for the ModelConfiguration component
 */
interface ModelConfigurationProps {
	// Provider capability overrides edited by this component.
	capabilities?: ModelCapabilities

	// Provider pricing overrides edited by this component.
	pricing?: ModelPricing

	// Update callback for provider capabilities.
	onCapabilitiesUpdate: (updates: Partial<ModelCapabilities>) => void

	// Update callback for provider pricing.
	onPricingUpdate: (updates: Partial<ModelPricing>) => void

	// Which fields to display (data-driven)
	fields: {
		// Capabilities related fields
		capabilities?: Array<"maxTokens" | "contextWindow" | "supportsImages" | "supportsPromptCache" | "temperature">
		// Pricing related fields (currency automatically shown first)
		pricing?: Array<"inputPrice" | "outputPrice" | "cacheWritesPrice" | "cacheReadsPrice">
	}

	// Default values (for placeholders)
	defaults?: Partial<ModelInfo>
}

/**
 * Reusable Model Configuration component for provider settings.
 * Displays a collapsible section with model capabilities and pricing.
 * All edits are stored in provider-specific capabilities and pricing.
 */
export const ModelConfiguration = ({
	capabilities: capabilityOverrides,
	pricing: pricingOverrides,
	onCapabilitiesUpdate,
	onPricingUpdate,
	fields,
	defaults,
}: ModelConfigurationProps) => {
	const [expanded, setExpanded] = useState(false)

	// Extract current values from provider overrides
	const capabilities: ModelCapabilities = capabilityOverrides ?? ({} as ModelCapabilities)
	const pricing: ModelPricing = pricingOverrides ?? ({} as ModelPricing)
	const temperature = capabilities.temperature

	// Derive currency symbol from pricing.currency
	const currencySymbol = (() => {
		const c = pricing.currency || "USD"
		const map: Record<string, string> = {
			USD: "$",
			CNY: "¥",
			EUR: "€",
			GBP: "£",
		}
		return map[c] || "$"
	})()

	// Update capability field
	const updateCapability = (field: keyof ModelCapabilities, value: ModelCapabilities[keyof ModelCapabilities]) => {
		onCapabilitiesUpdate({ [field]: value } as Partial<ModelCapabilities>)
	}

	// Update pricing field
	const updatePricing = (field: keyof ModelPricing, value: ModelPricing[keyof ModelPricing]) => {
		onPricingUpdate({ [field]: value } as Partial<ModelPricing>)
	}

	// Update currency (part of pricing)
	const updateCurrency = (currency: string) => {
		onPricingUpdate({ currency })
	}

	// Update temperature
	const updateTemperature = (value: number) => {
		onCapabilitiesUpdate({ temperature: value })
	}

	// Parse price value
	const parsePrice = (value: string, defaultValue = 0): number => {
		const parsed = Number.parseFloat(value)
		return Number.isNaN(parsed) ? defaultValue : parsed
	}

	return (
		<div style={{ marginBottom: 8 }}>
			{/* Collapsible header */}
			<div
				onClick={() => setExpanded(!expanded)}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault()
						setExpanded(!expanded)
					}
				}}
				role="button"
				style={{
					color: "var(--vscode-descriptionForeground)",
					display: "flex",
					margin: "10px 0",
					cursor: "pointer",
					alignItems: "center",
				}}
				tabIndex={0}>
				<span
					className={`codicon ${expanded ? "codicon-chevron-down" : "codicon-chevron-right"}`}
					style={{ marginRight: "4px" }}
				/>
				<span style={{ fontWeight: 700, textTransform: "uppercase" }}>Model Configuration</span>
			</div>

			{/* Collapsible content */}
			{expanded && (
				<>
					{/* 1. Currency selector (if pricing fields are present) */}
					{fields.pricing && fields.pricing.length > 0 && (
						<div style={{ marginTop: 5, marginBottom: 5 }}>
							<Label className="text-xs font-medium">Currency</Label>
							<Select onValueChange={updateCurrency} value={pricing.currency || "USD"}>
								<SelectTrigger className="w-full mt-1">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="USD">USD ($)</SelectItem>
									<SelectItem value="CNY">CNY (¥)</SelectItem>
									<SelectItem value="EUR">EUR (€)</SelectItem>
									<SelectItem value="GBP">GBP (£)</SelectItem>
								</SelectContent>
							</Select>
						</div>
					)}

					{/* 2. Pricing fields (in pairs) */}
					{fields.pricing && (
						<>
							{(fields.pricing.includes("inputPrice") || fields.pricing.includes("outputPrice")) && (
								<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
									{fields.pricing.includes("inputPrice") && (
										<DebouncedTextField
											initialValue={pricing.inputPrice != null ? String(pricing.inputPrice) : ""}
											onChange={(value) => updatePricing("inputPrice", parsePrice(value, 0))}
											placeholder={
												defaults?.pricing?.inputPrice != null ? String(defaults.pricing.inputPrice) : ""
											}
											style={{ flex: 1 }}>
											<span style={{ fontWeight: 500 }}>Input Price ({currencySymbol}/1M tokens)</span>
										</DebouncedTextField>
									)}

									{fields.pricing.includes("outputPrice") && (
										<DebouncedTextField
											initialValue={pricing.outputPrice != null ? String(pricing.outputPrice) : ""}
											onChange={(value) => updatePricing("outputPrice", parsePrice(value, 0))}
											placeholder={
												defaults?.pricing?.outputPrice != null ? String(defaults.pricing.outputPrice) : ""
											}
											style={{ flex: 1 }}>
											<span style={{ fontWeight: 500 }}>Output Price ({currencySymbol}/1M tokens)</span>
										</DebouncedTextField>
									)}
								</div>
							)}

							{(fields.pricing.includes("cacheWritesPrice") || fields.pricing.includes("cacheReadsPrice")) && (
								<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
									{fields.pricing.includes("cacheWritesPrice") && (
										<DebouncedTextField
											initialValue={
												pricing.cacheWritesPrice != null ? String(pricing.cacheWritesPrice) : ""
											}
											onChange={(value) => updatePricing("cacheWritesPrice", parsePrice(value, 0))}
											placeholder={
												defaults?.pricing?.cacheWritesPrice != null
													? String(defaults.pricing.cacheWritesPrice)
													: ""
											}
											style={{ flex: 1 }}>
											<span style={{ fontWeight: 500 }}>Cache Writes ({currencySymbol}/M)</span>
										</DebouncedTextField>
									)}

									{fields.pricing.includes("cacheReadsPrice") && (
										<DebouncedTextField
											initialValue={pricing.cacheReadsPrice != null ? String(pricing.cacheReadsPrice) : ""}
											onChange={(value) => updatePricing("cacheReadsPrice", parsePrice(value, 0))}
											placeholder={
												defaults?.pricing?.cacheReadsPrice != null
													? String(defaults.pricing.cacheReadsPrice)
													: ""
											}
											style={{ flex: 1 }}>
											<span style={{ fontWeight: 500 }}>Cache Reads ({currencySymbol}/M)</span>
										</DebouncedTextField>
									)}
								</div>
							)}
						</>
					)}

					{/* 3. Capabilities fields (in pairs) */}
					{fields.capabilities && (
						<>
							{(fields.capabilities.includes("contextWindow") || fields.capabilities.includes("maxTokens")) && (
								<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
									{fields.capabilities.includes("contextWindow") && (
										<DebouncedTextField
											initialValue={
												capabilities.contextWindow != null ? String(capabilities.contextWindow) : ""
											}
											onChange={(value) => updateCapability("contextWindow", Number(value) || 0)}
											placeholder={
												defaults?.capabilities?.contextWindow != null
													? String(defaults.capabilities.contextWindow)
													: ""
											}
											style={{ flex: 1 }}>
											<span style={{ fontWeight: 500 }}>Context Window Size</span>
										</DebouncedTextField>
									)}

									{fields.capabilities.includes("maxTokens") && (
										<DebouncedTextField
											initialValue={capabilities.maxTokens != null ? String(capabilities.maxTokens) : ""}
											onChange={(value) => updateCapability("maxTokens", Number(value) || 0)}
											placeholder={
												defaults?.capabilities?.maxTokens != null
													? String(defaults.capabilities.maxTokens)
													: ""
											}
											style={{ flex: 1 }}>
											<span style={{ fontWeight: 500 }}>Max Output Tokens</span>
										</DebouncedTextField>
									)}
								</div>
							)}

							{/* Checkboxes for boolean capabilities */}
							{(fields.capabilities.includes("supportsImages") ||
								fields.capabilities.includes("supportsPromptCache")) && (
								<div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
									<Label className="text-xs font-medium">Options</Label>
									{fields.capabilities.includes("supportsImages") && (
										<VSCodeCheckbox
											checked={Boolean(capabilities.supportsImages ?? false)}
											onChange={(e: Event | React.FormEvent<HTMLElement>) =>
												updateCapability(
													"supportsImages",
													(e.target as HTMLInputElement | null)?.checked === true,
												)
											}>
											Supports Images
										</VSCodeCheckbox>
									)}
									{fields.capabilities.includes("supportsPromptCache") && (
										<VSCodeCheckbox
											checked={Boolean(capabilities.supportsPromptCache ?? true)}
											onChange={(e: Event | React.FormEvent<HTMLElement>) =>
												updateCapability(
													"supportsPromptCache",
													(e.target as HTMLInputElement | null)?.checked === true,
												)
											}>
											Supports Prompt Cache
										</VSCodeCheckbox>
									)}
								</div>
							)}
						</>
					)}

					{/* 4. Temperature field */}
					{fields.capabilities?.includes("temperature") && (
						<DebouncedTextField
							initialValue={temperature != null ? String(temperature) : ""}
							onChange={(value) => updateTemperature(parsePrice(value, 0))}
							placeholder={
								defaults?.capabilities?.temperature != null
									? String(defaults.capabilities.temperature)
									: defaults?.temperature != null
										? String(defaults.temperature)
										: ""
							}
							style={{ marginTop: "5px" }}>
							<span style={{ fontWeight: 500 }}>Temperature</span>
						</DebouncedTextField>
					)}
				</>
			)}
		</div>
	)
}
