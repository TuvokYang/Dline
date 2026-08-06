import type { ModelInfo } from "@shared/proto/dline/models"
import { type ModelCapabilities, type ModelPricing, ServerTool } from "@shared/proto/dline/models/metadata"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DebouncedTextField } from "./DebouncedTextField"
import { ContextTierEditor, PricingTierEditor } from "./ModelTierEditor"

const BUILT_IN_CONTEXT_WINDOW = 128_000
const BUILT_IN_MAX_TOKENS = 8_192

type CapabilityCheckField =
	| "supportsImages"
	| "supportsPromptCache"
	| "supportsTools"
	| "supportsWebSearch"
	| "supportsBrowserAction"

const sectionTitleStyle = {
	color: "var(--vscode-descriptionForeground)",
	fontSize: "11px",
	fontWeight: 600,
	letterSpacing: "0.02em",
	textTransform: "uppercase",
} as const

const fieldLabelStyle = {
	color: "var(--vscode-descriptionForeground)",
	fontSize: "12px",
	fontWeight: 400,
} as const

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
		capabilities?: Array<
			| "maxTokens"
			| "contextWindow"
			| "contextWindowTiers"
			| "supportsImages"
			| "supportsPromptCache"
			| "supportsTools"
			| "supportsWebSearch"
			| "supportsBrowserAction"
			| "temperature"
		>
		// Pricing related fields (currency automatically shown first)
		pricing?: Array<"inputPrice" | "outputPrice" | "cacheWritesPrice" | "cacheReadsPrice" | "pricingTiers">
	}

	// Default values (for placeholders)
	defaults?: Partial<ModelInfo>

	// Whether tier arrays can be added, edited, and removed.
	tiersEditable?: boolean
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
	tiersEditable = false,
}: ModelConfigurationProps) => {
	const [expanded, setExpanded] = useState(false)
	const [draftChecks, setDraftChecks] = useState<Partial<Record<CapabilityCheckField, boolean>>>({})
	const [pendingChecks, setPendingChecks] = useState<Partial<Record<CapabilityCheckField, boolean>>>({})
	// Show registry defaults until the user edits them; edits persist as provider overrides.
	const [draftContextTiers, setDraftContextTiers] = useState(
		capabilityOverrides?.contextWindowTiers ?? defaults?.capabilities?.contextWindowTiers ?? [],
	)
	const [draftPricingTiers, setDraftPricingTiers] = useState(pricingOverrides?.tiers ?? defaults?.pricing?.tiers ?? [])

	// Extract current values from provider overrides
	const capabilities: ModelCapabilities = capabilityOverrides ?? ({} as ModelCapabilities)
	const pricing: ModelPricing = pricingOverrides ?? ({} as ModelPricing)
	const temperature = capabilities.temperature

	useEffect(() => {
		setPendingChecks((pending) => {
			const nextPending = { ...pending }
			const nextDraft = { ...draftChecks }
			let changed = false
			for (const field of [
				"supportsImages",
				"supportsPromptCache",
				"supportsTools",
				"supportsWebSearch",
				"supportsBrowserAction",
			] as const) {
				const expected = pending[field]
				const persisted = (() => {
					switch (field) {
						case "supportsImages":
							return capabilities.supportsImages ?? false
						case "supportsPromptCache":
							return capabilities.supportsPromptCache ?? true
						case "supportsTools":
							return capabilities.supportsTools ?? defaults?.capabilities?.supportsTools ?? false
						case "supportsWebSearch":
							return (capabilityOverrides?.tools ?? defaults?.capabilities?.tools ?? []).includes(
								ServerTool.WEB_SEARCH,
							)
						case "supportsBrowserAction":
							return capabilities.supportsBrowserAction ?? defaults?.capabilities?.supportsBrowserAction ?? false
					}
				})()
				if (expected !== undefined && persisted === expected) {
					delete nextPending[field]
					delete nextDraft[field]
					changed = true
				}
			}
			if (changed) {
				setDraftChecks(nextDraft)
			}
			return changed ? nextPending : pending
		})
	}, [
		capabilities.supportsImages,
		capabilities.supportsPromptCache,
		capabilities.supportsTools,
		capabilities.supportsBrowserAction,
		capabilityOverrides?.tools,
		defaults?.capabilities?.supportsTools,
		defaults?.capabilities?.supportsBrowserAction,
		defaults?.capabilities?.tools,
		draftChecks,
	])

	useEffect(() => {
		setDraftContextTiers(capabilityOverrides?.contextWindowTiers ?? defaults?.capabilities?.contextWindowTiers ?? [])
	}, [capabilityOverrides?.contextWindowTiers, defaults?.capabilities?.contextWindowTiers])

	useEffect(() => {
		setDraftPricingTiers(pricingOverrides?.tiers ?? defaults?.pricing?.tiers ?? [])
	}, [pricingOverrides?.tiers, defaults?.pricing?.tiers])

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

	/** Optimistically update a capability checkbox until its persisted echo arrives. */
	const updateCheck = (
		field: "supportsImages" | "supportsPromptCache" | "supportsTools" | "supportsBrowserAction",
		value: boolean,
	) => {
		setDraftChecks((draft) => ({ ...draft, [field]: value }))
		setPendingChecks((pending) => ({ ...pending, [field]: value }))
		updateCapability(field, value)
	}

	/** Map the Web Search checkbox to the ServerTool list without discarding other server tools. */
	const updateWebSearchCheck = (value: boolean) => {
		setDraftChecks((draft) => ({ ...draft, supportsWebSearch: value }))
		setPendingChecks((pending) => ({ ...pending, supportsWebSearch: value }))
		const currentTools = capabilityOverrides?.tools ?? defaults?.capabilities?.tools ?? []
		const tools = value
			? currentTools.includes(ServerTool.WEB_SEARCH)
				? currentTools
				: [...currentTools, ServerTool.WEB_SEARCH]
			: currentTools.filter((tool) => tool !== ServerTool.WEB_SEARCH)
		updateCapability("tools", tools)
	}

	/** Persist context tier changes while keeping the editor responsive before profile echo. */
	const updateContextTiers = (tiers: ModelCapabilities["contextWindowTiers"]) => {
		const nextTiers = tiers ?? []
		setDraftContextTiers(nextTiers)
		updateCapability("contextWindowTiers", nextTiers)
	}

	// Update pricing field
	const updatePricing = (field: keyof ModelPricing, value: ModelPricing[keyof ModelPricing]) => {
		onPricingUpdate({ [field]: value } as Partial<ModelPricing>)
	}

	/** Persist pricing tier changes while keeping the editor responsive before profile echo. */
	const updatePricingTiers = (tiers: ModelPricing["tiers"]) => {
		const nextTiers = tiers ?? []
		setDraftPricingTiers(nextTiers)
		updatePricing("tiers", nextTiers)
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

	const capabilityFields = fields.capabilities ?? []
	const pricingFields = fields.pricing ?? []
	const supportsImages = draftChecks.supportsImages ?? capabilities.supportsImages ?? false
	const supportsPromptCache = draftChecks.supportsPromptCache ?? capabilities.supportsPromptCache ?? true
	const supportsTools =
		draftChecks.supportsTools ?? capabilities.supportsTools ?? defaults?.capabilities?.supportsTools ?? false
	const supportsWebSearch =
		draftChecks.supportsWebSearch ??
		(capabilityOverrides?.tools ?? defaults?.capabilities?.tools ?? []).includes(ServerTool.WEB_SEARCH)
	const supportsBrowserAction =
		draftChecks.supportsBrowserAction ??
		capabilities.supportsBrowserAction ??
		defaults?.capabilities?.supportsBrowserAction ??
		false
	const hasOptionsFields =
		capabilityFields.includes("supportsImages") ||
		capabilityFields.includes("supportsPromptCache") ||
		capabilityFields.includes("supportsTools") ||
		capabilityFields.includes("supportsWebSearch") ||
		capabilityFields.includes("supportsBrowserAction") ||
		capabilityFields.includes("temperature")
	const hasCapabilityFields =
		capabilityFields.includes("contextWindow") ||
		capabilityFields.includes("maxTokens") ||
		capabilityFields.includes("contextWindowTiers")
	const hasPricingFields = pricingFields.length > 0
	const hasBasePricingFields = pricingFields.includes("inputPrice") || pricingFields.includes("outputPrice")
	const hasCachePricingFields =
		supportsPromptCache && (pricingFields.includes("cacheWritesPrice") || pricingFields.includes("cacheReadsPrice"))
	const defaultContextWindow = defaults?.capabilities?.contextWindow ?? BUILT_IN_CONTEXT_WINDOW
	const defaultMaxTokens = defaults?.capabilities?.maxTokens ?? BUILT_IN_MAX_TOKENS
	const contextWindowValue = capabilities.contextWindow ?? defaultContextWindow
	const maxTokensValue = capabilities.maxTokens ?? defaultMaxTokens
	const contextTiers = draftContextTiers
	const pricingTiers = draftPricingTiers

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
					{hasOptionsFields && (
						<div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
							<Label style={sectionTitleStyle}>Options</Label>
							{capabilityFields.includes("supportsImages") && (
								<VSCodeCheckbox
									checked={supportsImages}
									onChange={(e: Event | React.FormEvent<HTMLElement>) =>
										updateCheck("supportsImages", (e.target as HTMLInputElement | null)?.checked === true)
									}>
									Supports Images
								</VSCodeCheckbox>
							)}
							{capabilityFields.includes("supportsWebSearch") && (
								<VSCodeCheckbox
									checked={supportsWebSearch}
									onChange={(e: Event | React.FormEvent<HTMLElement>) =>
										updateWebSearchCheck((e.target as HTMLInputElement | null)?.checked === true)
									}>
									Supports Web Search
								</VSCodeCheckbox>
							)}
							{capabilityFields.includes("supportsBrowserAction") && (
								<VSCodeCheckbox
									checked={supportsBrowserAction}
									onChange={(e: Event | React.FormEvent<HTMLElement>) =>
										updateCheck(
											"supportsBrowserAction",
											(e.target as HTMLInputElement | null)?.checked === true,
										)
									}>
									Supports Browser Actions
								</VSCodeCheckbox>
							)}
							{capabilityFields.includes("supportsPromptCache") && (
								<VSCodeCheckbox
									checked={supportsPromptCache}
									onChange={(e: Event | React.FormEvent<HTMLElement>) =>
										updateCheck(
											"supportsPromptCache",
											(e.target as HTMLInputElement | null)?.checked === true,
										)
									}>
									Supports Prompt Cache
								</VSCodeCheckbox>
							)}
							{capabilityFields.includes("supportsTools") && (
								<VSCodeCheckbox
									checked={supportsTools}
									onChange={(e: Event | React.FormEvent<HTMLElement>) =>
										updateCheck("supportsTools", (e.target as HTMLInputElement | null)?.checked === true)
									}>
									Supports Native Tool Calls
								</VSCodeCheckbox>
							)}
							{capabilityFields.includes("temperature") && (
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
									<span style={fieldLabelStyle}>Temperature</span>
								</DebouncedTextField>
							)}
						</div>
					)}

					{hasCapabilityFields && (
						<div style={{ marginTop: 10 }}>
							<Label style={sectionTitleStyle}>Capabilities</Label>
							<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
								{capabilityFields.includes("contextWindow") && (
									<DebouncedTextField
										initialValue={String(contextWindowValue)}
										onChange={(value) => updateCapability("contextWindow", Number(value) || 0)}
										placeholder={String(defaultContextWindow)}
										style={{ flex: 1 }}>
										<span style={fieldLabelStyle}>Context Window Size</span>
									</DebouncedTextField>
								)}
								{capabilityFields.includes("maxTokens") && (
									<DebouncedTextField
										initialValue={String(maxTokensValue)}
										onChange={(value) => updateCapability("maxTokens", Number(value) || 0)}
										placeholder={String(defaultMaxTokens)}
										style={{ flex: 1 }}>
										<span style={fieldLabelStyle}>Max Output Tokens</span>
									</DebouncedTextField>
								)}
							</div>
							{capabilityFields.includes("contextWindowTiers") ? (
								<ContextTierEditor editable={tiersEditable} onChange={updateContextTiers} tiers={contextTiers} />
							) : null}
						</div>
					)}

					{hasPricingFields && (
						<div style={{ marginTop: 10 }}>
							<Label style={sectionTitleStyle}>Pricing</Label>
							<div style={{ marginTop: 5, marginBottom: 5 }}>
								<Label style={fieldLabelStyle}>Currency</Label>
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

							{hasBasePricingFields && (
								<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
									{pricingFields.includes("inputPrice") && (
										<DebouncedTextField
											initialValue={pricing.inputPrice != null ? String(pricing.inputPrice) : ""}
											onChange={(value) => updatePricing("inputPrice", parsePrice(value, 0))}
											placeholder={
												defaults?.pricing?.inputPrice != null ? String(defaults.pricing.inputPrice) : ""
											}
											style={{ flex: 1 }}>
											<span style={fieldLabelStyle}>Input Price ({currencySymbol}/1M tokens)</span>
										</DebouncedTextField>
									)}
									{pricingFields.includes("outputPrice") && (
										<DebouncedTextField
											initialValue={pricing.outputPrice != null ? String(pricing.outputPrice) : ""}
											onChange={(value) => updatePricing("outputPrice", parsePrice(value, 0))}
											placeholder={
												defaults?.pricing?.outputPrice != null ? String(defaults.pricing.outputPrice) : ""
											}
											style={{ flex: 1 }}>
											<span style={fieldLabelStyle}>Output Price ({currencySymbol}/1M tokens)</span>
										</DebouncedTextField>
									)}
								</div>
							)}

							{hasCachePricingFields && (
								<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
									{pricingFields.includes("cacheWritesPrice") && (
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
											<span style={fieldLabelStyle}>Cache Writes ({currencySymbol}/M)</span>
										</DebouncedTextField>
									)}
									{pricingFields.includes("cacheReadsPrice") && (
										<DebouncedTextField
											initialValue={pricing.cacheReadsPrice != null ? String(pricing.cacheReadsPrice) : ""}
											onChange={(value) => updatePricing("cacheReadsPrice", parsePrice(value, 0))}
											placeholder={
												defaults?.pricing?.cacheReadsPrice != null
													? String(defaults.pricing.cacheReadsPrice)
													: ""
											}
											style={{ flex: 1 }}>
											<span style={fieldLabelStyle}>Cache Reads ({currencySymbol}/M)</span>
										</DebouncedTextField>
									)}
								</div>
							)}

							{pricingFields.includes("pricingTiers") ? (
								<PricingTierEditor
									currencySymbol={currencySymbol}
									editable={tiersEditable}
									onChange={updatePricingTiers}
									showCachePrices={supportsPromptCache}
									tiers={pricingTiers}
								/>
							) : null}
						</div>
					)}
				</>
			)}
		</div>
	)
}
