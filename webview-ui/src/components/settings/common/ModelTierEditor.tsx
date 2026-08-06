import type { ContextWindowTier, PricingTier } from "@shared/proto/dline/models/metadata"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { DebouncedTextField } from "./DebouncedTextField"

const tierTitleStyle = {
	color: "var(--vscode-descriptionForeground)",
	fontSize: "11px",
	fontWeight: 600,
	letterSpacing: "0.02em",
	textTransform: "uppercase",
} as const

const tierLabelStyle = {
	color: "var(--vscode-descriptionForeground)",
	fontSize: "12px",
	fontWeight: 400,
} as const

/**
 * Build the alternating visual style for a tier card.
 *
 * @param index Tier position in the displayed list.
 * @returns Inline style that visually separates adjacent tiers.
 */
function getTierStyle(index: number): React.CSSProperties {
	return {
		background: index % 2 === 0 ? "var(--vscode-editor-background)" : "var(--vscode-sideBar-background)",
		border: "1px solid var(--vscode-widget-border)",
		borderRadius: 4,
		display: "flex",
		flexDirection: "column",
		gap: 6,
		marginTop: 6,
		padding: 8,
	}
}

/**
 * Parse a numeric tier field without emitting NaN.
 *
 * @param value Text entered by the user.
 * @returns Parsed number, or zero for an invalid value.
 */
function parseTierNumber(value: string): number {
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : 0
}

interface ContextTierEditorProps {
	tiers: ContextWindowTier[]
	editable: boolean
	onChange: (tiers: ContextWindowTier[]) => void
}

/**
 * Render context window tiers in read-only or editable mode.
 *
 * @param props Context tier values, editability, and update callback.
 * @returns Context tier editor section.
 */
export function ContextTierEditor({ tiers, editable, onChange }: ContextTierEditorProps) {
	/** Add a default editable context tier. */
	const addTier = () => {
		onChange([...tiers, { id: "standard", contextWindow: 128_000, label: "128K", apiModelSuffix: "" }])
	}

	/** Update one context tier without mutating props. */
	const updateTier = (index: number, updates: Partial<ContextWindowTier>) => {
		onChange(tiers.map((tier, tierIndex) => (tierIndex === index ? { ...tier, ...updates } : tier)))
	}

	/** Remove one context tier by index. */
	const removeTier = (index: number) => {
		onChange(tiers.filter((_, tierIndex) => tierIndex !== index))
	}

	return (
		<div style={{ marginTop: 10 }}>
			<div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
				<span style={tierTitleStyle}>Context Tiers</span>
				{editable ? <VSCodeButton onClick={addTier}>Add Context Tier</VSCodeButton> : null}
			</div>
			{tiers.map((tier, index) => (
				<div key={`${tier.id}-${index}`} style={getTierStyle(index)}>
					{editable ? (
						<>
							<DebouncedTextField initialValue={tier.id} onChange={(value) => updateTier(index, { id: value })}>
								<span style={tierLabelStyle}>Context Tier ID</span>
							</DebouncedTextField>
							<DebouncedTextField
								initialValue={String(tier.contextWindow)}
								onChange={(value) => updateTier(index, { contextWindow: parseTierNumber(value) })}>
								<span style={tierLabelStyle}>Context Tier Window</span>
							</DebouncedTextField>
							<DebouncedTextField
								initialValue={tier.label ?? ""}
								onChange={(value) => updateTier(index, { label: value })}>
								<span style={tierLabelStyle}>Context Tier Label</span>
							</DebouncedTextField>
							<DebouncedTextField
								initialValue={tier.apiModelSuffix ?? ""}
								onChange={(value) => updateTier(index, { apiModelSuffix: value })}>
								<span style={tierLabelStyle}>API Model Suffix</span>
							</DebouncedTextField>
							<VSCodeButton appearance="secondary" onClick={() => removeTier(index)}>
								Remove Context Tier
							</VSCodeButton>
						</>
					) : (
						<>
							<strong>{tier.id}</strong>
							<span>{tier.label ?? tier.contextWindow.toLocaleString()}</span>
							<span>{tier.contextWindow.toLocaleString()} tokens</span>
							{tier.apiModelSuffix ? <span>API suffix: {tier.apiModelSuffix}</span> : null}
						</>
					)}
				</div>
			))}
		</div>
	)
}

interface PricingTierEditorProps {
	tiers: PricingTier[]
	editable: boolean
	currencySymbol: string
	showCachePrices: boolean
	onChange: (tiers: PricingTier[]) => void
}

/**
 * Render usage-based tiered pricing in read-only or editable mode.
 *
 * Each tier's threshold is the maximum input-token usage for that price band;
 * it controls pricing, not the context window.
 *
 * @param props Pricing values, editability, currency, and update callback.
 * @returns Pricing tier editor section.
 */
export function PricingTierEditor({ tiers, editable, currencySymbol, showCachePrices, onChange }: PricingTierEditorProps) {
	/** Add a default editable pricing tier. */
	const addTier = () => {
		onChange([...tiers, { contextWindow: 128_000, inputPrice: 0, outputPrice: 0, cacheWritesPrice: 0, cacheReadsPrice: 0 }])
	}

	/** Update one pricing tier without mutating props. */
	const updateTier = (index: number, updates: Partial<PricingTier>) => {
		onChange(tiers.map((tier, tierIndex) => (tierIndex === index ? { ...tier, ...updates } : tier)))
	}

	/** Remove one pricing tier by index. */
	const removeTier = (index: number) => {
		onChange(tiers.filter((_, tierIndex) => tierIndex !== index))
	}

	return (
		<div style={{ marginTop: 10 }}>
			<div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
				<span style={tierTitleStyle}>Pricing Tiers</span>
				{editable ? <VSCodeButton onClick={addTier}>Add Pricing Tier</VSCodeButton> : null}
			</div>
			{tiers.map((tier, index) => (
				<div key={`${tier.contextWindow}-${index}`} style={getTierStyle(index)}>
					{editable ? (
						<>
							<DebouncedTextField
								initialValue={String(tier.contextWindow)}
								onChange={(value) => updateTier(index, { contextWindow: parseTierNumber(value) })}>
								<span style={tierLabelStyle}>Up To Input Tokens</span>
							</DebouncedTextField>
							<DebouncedTextField
								initialValue={String(tier.inputPrice ?? 0)}
								onChange={(value) => updateTier(index, { inputPrice: parseTierNumber(value) })}>
								<span style={tierLabelStyle}>Tier Input Price ({currencySymbol}/1M)</span>
							</DebouncedTextField>
							<DebouncedTextField
								initialValue={String(tier.outputPrice ?? 0)}
								onChange={(value) => updateTier(index, { outputPrice: parseTierNumber(value) })}>
								<span style={tierLabelStyle}>Tier Output Price ({currencySymbol}/1M)</span>
							</DebouncedTextField>
							{showCachePrices ? (
								<>
									<DebouncedTextField
										initialValue={String(tier.cacheWritesPrice ?? 0)}
										onChange={(value) => updateTier(index, { cacheWritesPrice: parseTierNumber(value) })}>
										<span style={tierLabelStyle}>Tier Cache Writes ({currencySymbol}/1M)</span>
									</DebouncedTextField>
									<DebouncedTextField
										initialValue={String(tier.cacheReadsPrice ?? 0)}
										onChange={(value) => updateTier(index, { cacheReadsPrice: parseTierNumber(value) })}>
										<span style={tierLabelStyle}>Tier Cache Reads ({currencySymbol}/1M)</span>
									</DebouncedTextField>
								</>
							) : null}
							<VSCodeButton appearance="secondary" onClick={() => removeTier(index)}>
								Remove Pricing Tier
							</VSCodeButton>
						</>
					) : (
						<>
							<strong>{tier.contextWindow.toLocaleString()} tokens</strong>
							<span>
								Input: {currencySymbol}
								{tier.inputPrice ?? 0}/1M
							</span>
							<span>
								Output: {currencySymbol}
								{tier.outputPrice ?? 0}/1M
							</span>
							{showCachePrices ? (
								<span>
									Cache: {currencySymbol}
									{tier.cacheWritesPrice ?? 0} write / {currencySymbol}
									{tier.cacheReadsPrice ?? 0} read
								</span>
							) : null}
						</>
					)}
				</div>
			))}
		</div>
	)
}
