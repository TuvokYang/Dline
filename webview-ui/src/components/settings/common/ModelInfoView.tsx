import { geminiModels, ModelInfo } from "@shared/api"
import type { PricingTier } from "@shared/providers/types"
import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import styled from "styled-components"
import { ModelDescriptionMarkdown } from "../ModelDescriptionMarkdown"
import { formatPrice, hasThinkingBudget, supportsBrowserUse, supportsImages, supportsPromptCache } from "../utils/pricingUtils"

// ========== Styled Components ==========

const InfoRow = styled.div`
	display: flex;
	column-gap: 16px;
	row-gap: 4px;
	font-size: 12px;
	color: var(--vscode-foreground);
	margin-top: 8px;
	flex-wrap: wrap;
`

const InfoItem = styled.span`
	white-space: nowrap;
`

const InfoLabel = styled.span`
	color: var(--vscode-descriptionForeground);
`

const InfoValue = styled.span`
	font-weight: 500;
`

const CollapsibleHeader = styled.div`
	display: flex;
	align-items: center;
	gap: 6px;
	margin-top: 12px;
	cursor: pointer;
	user-select: none;
	font-size: 11px;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	color: var(--vscode-descriptionForeground);

	&:hover {
		color: var(--vscode-foreground);
	}
`

const CollapsibleArrow = styled.span<{ $isExpanded: boolean }>`
	font-size: 10px;
	transition: transform 0.15s ease;
	transform: rotate(${({ $isExpanded }) => ($isExpanded ? "90deg" : "0deg")});
`

const CollapsibleContent = styled.div<{ $isExpanded: boolean }>`
	max-height: ${({ $isExpanded }) => ($isExpanded ? "800px" : "0")};
	overflow: ${({ $isExpanded }) => ($isExpanded ? "visible" : "hidden")};
	transition: max-height 0.2s ease;
`

const AdvancedSection = styled.div`
	padding-top: 8px;
	font-size: 12px;
	color: var(--vscode-descriptionForeground);
`

const AdvancedRow = styled.div`
	display: flex;
	justify-content: space-between;
	padding: 4px 0;
`

const AdvancedLabel = styled.span``

const AdvancedValue = styled.span`
	color: var(--vscode-foreground);
`

const ProviderRoutingContainer = styled.div`
	margin-top: 8px;
	margin-bottom: 8px;
`

const ProviderRoutingLabel = styled.label`
	display: block;
	font-size: 12px;
	color: var(--vscode-descriptionForeground);
	margin-bottom: 4px;
`

// ========== Helper Functions ==========

/**
 * Format price for compact display (e.g., "$5/M" for $5 per million tokens)
 * Price is already in per-million format from OpenRouter
 */
const formatCompactPrice = (price: number | undefined): string => {
	if (price === undefined) {
		return "N/A"
	}
	if (price === 0) {
		return "Free"
	}
	if (price < 0.01) {
		return `$${price.toFixed(4)}/M`
	}
	if (price < 1) {
		return `$${price.toFixed(2)}/M`
	}
	return `$${price % 1 === 0 ? price : price.toFixed(2)}/M`
}

/**
 * Format context window for compact display (e.g., "200K")
 */
const formatCompactContext = (contextWindow: number | undefined): string => {
	if (!contextWindow) {
		return "N/A"
	}
	if (contextWindow >= 1_000_000) {
		return `${(contextWindow / 1_000_000).toFixed(contextWindow % 1_000_000 === 0 ? 0 : 1)}M`
	}
	return `${Math.round(contextWindow / 1000)}K`
}

/**
 * Format usage-based tiered pricing: each tier's threshold is the maximum
 * input-token usage for that price band. The threshold controls pricing only,
 * not the context window.
 */
const formatTiers = (
	tiers: PricingTier[],
	priceType: "inputPrice" | "outputPrice" | "cacheReadsPrice" | "cacheWritesPrice",
): JSX.Element[] => {
	if (!tiers || tiers.length === 0) {
		return []
	}

	return tiers
		.map((tier, index, arr) => {
			const prevLimit = index > 0 ? arr[index - 1].contextWindow : 0
			const price = tier[priceType]

			if (price === undefined) {
				return null
			}

			return (
				<span key={`tier-${tier.contextWindow}`} style={{ paddingLeft: "15px" }}>
					{formatPrice(price)}/million tokens (
					{tier.contextWindow === Number.POSITIVE_INFINITY || tier.contextWindow >= Number.MAX_SAFE_INTEGER ? (
						<span>
							{">"} {prevLimit.toLocaleString()} input tokens
						</span>
					) : (
						<span>
							{"<="} {tier.contextWindow?.toLocaleString()} input tokens
						</span>
					)}
					{")"}
					{index < arr.length - 1 && <br />}
				</span>
			)
		})
		.filter((element): element is JSX.Element => element !== null)
}

// ========== Props ==========

interface ModelInfoViewProps {
	selectedModelId: string
	modelInfo: ModelInfo
	isPopup?: boolean
	// Provider routing props (optional - only shown for Cline provider)
	providerSorting?: string
	onProviderSortingChange?: (value: string) => void
	showProviderRouting?: boolean
}

// ========== Component ==========

export const ModelInfoView = ({
	selectedModelId,
	modelInfo,
	isPopup,
	providerSorting,
	onProviderSortingChange,
	showProviderRouting,
}: ModelInfoViewProps) => {
	const [advancedExpanded, setAdvancedExpanded] = useState(false)

	const isGemini = Object.keys(geminiModels).includes(selectedModelId)
	const hasThinkingConfig = hasThinkingBudget(modelInfo)
	const hasTiers = !!modelInfo.pricing?.tiers && modelInfo.pricing.tiers.length > 0
	const contextTiers = modelInfo.capabilities?.contextWindowTiers ?? []

	// Capability checks
	const hasImages = supportsImages(modelInfo)
	const hasBrowser = supportsBrowserUse(modelInfo)
	const hasCaching = !isGemini && supportsPromptCache(modelInfo)

	// Check if we have cache pricing to show in Advanced section
	const hasCachePricing =
		modelInfo.capabilities?.supportsPromptCache && (modelInfo.pricing?.cacheWritesPrice || modelInfo.pricing?.cacheReadsPrice)

	return (
		<div style={{ marginTop: 4 }}>
			{/* Description */}
			{modelInfo.description && (
				<ModelDescriptionMarkdown isPopup={isPopup} key="description" markdown={modelInfo.description} />
			)}

			{/* Compact Info Row: Context, Input, Output */}
			<InfoRow>
				{modelInfo.capabilities?.contextWindow !== undefined && modelInfo.capabilities?.contextWindow > 0 && (
					<InfoItem>
						<InfoLabel>Context: </InfoLabel>
						<InfoValue>{formatCompactContext(modelInfo.capabilities?.contextWindow)}</InfoValue>
					</InfoItem>
				)}
				{modelInfo.pricing?.inputPrice !== undefined && (
					<InfoItem>
						<InfoLabel>Input: </InfoLabel>
						<InfoValue>{formatCompactPrice(modelInfo.pricing.inputPrice)}</InfoValue>
					</InfoItem>
				)}
				{modelInfo.pricing?.outputPrice !== undefined && (
					<InfoItem>
						<InfoLabel>Output: </InfoLabel>
						<InfoValue>
							{hasThinkingConfig && modelInfo.pricing?.thinkingOutputPrice !== undefined
								? formatCompactPrice(modelInfo.pricing.thinkingOutputPrice)
								: formatCompactPrice(modelInfo.pricing.outputPrice)}
						</InfoValue>
					</InfoItem>
				)}
			</InfoRow>

			{/* Collapsible Advanced Section */}
			<CollapsibleHeader onClick={() => setAdvancedExpanded(!advancedExpanded)}>
				<CollapsibleArrow $isExpanded={advancedExpanded}>▶</CollapsibleArrow>
				Advanced
			</CollapsibleHeader>
			<CollapsibleContent $isExpanded={advancedExpanded}>
				<AdvancedSection>
					{/* Capabilities */}
					<AdvancedRow>
						<AdvancedLabel>Images</AdvancedLabel>
						<AdvancedValue>{hasImages ? "Yes" : "No"}</AdvancedValue>
					</AdvancedRow>
					<AdvancedRow>
						<AdvancedLabel>Browser</AdvancedLabel>
						<AdvancedValue>{hasBrowser ? "Yes" : "No"}</AdvancedValue>
					</AdvancedRow>
					{!isGemini && (
						<AdvancedRow>
							<AdvancedLabel>Prompt Caching</AdvancedLabel>
							<AdvancedValue>{hasCaching ? "Yes" : "No"}</AdvancedValue>
						</AdvancedRow>
					)}

					{contextTiers.length > 0 && (
						<div style={{ marginTop: 8 }}>
							<div style={{ fontWeight: 500, marginBottom: 4 }}>Context Window Tiers:</div>
							{contextTiers.map((tier) => (
								<div key={tier.id}>
									{tier.label || tier.id}: {formatCompactContext(tier.contextWindow)}
								</div>
							))}
						</div>
					)}

					{/* Cache Pricing */}
					{hasCachePricing && (
						<>
							{modelInfo.pricing?.cacheReadsPrice !== undefined && (
								<AdvancedRow>
									<AdvancedLabel>Cache Reads</AdvancedLabel>
									<AdvancedValue>{formatCompactPrice(modelInfo.pricing?.cacheReadsPrice)}</AdvancedValue>
								</AdvancedRow>
							)}
							{modelInfo.pricing?.cacheWritesPrice !== undefined && (
								<AdvancedRow>
									<AdvancedLabel>Cache Writes</AdvancedLabel>
									<AdvancedValue>{formatCompactPrice(modelInfo.pricing?.cacheWritesPrice)}</AdvancedValue>
								</AdvancedRow>
							)}
						</>
					)}

					{/* Tiered Pricing */}
					{hasTiers && (
						<div style={{ marginTop: 8 }}>
							<div style={{ fontWeight: 500, marginBottom: 4 }}>Tiered Pricing:</div>
							{modelInfo.pricing?.tiers && (
								<>
									<div>
										<span style={{ fontWeight: 500 }}>Input:</span>
										<br />
										{formatTiers(modelInfo.pricing?.tiers, "inputPrice")}
									</div>
									<div style={{ marginTop: 4 }}>
										<span style={{ fontWeight: 500 }}>Output:</span>
										<br />
										{formatTiers(modelInfo.pricing?.tiers, "outputPrice")}
									</div>
									{modelInfo.capabilities?.supportsPromptCache && (
										<>
											<div style={{ marginTop: 4 }}>
												<span style={{ fontWeight: 500 }}>Cache Writes:</span>
												<br />
												{formatTiers(modelInfo.pricing?.tiers, "cacheWritesPrice")}
											</div>
											<div style={{ marginTop: 4 }}>
												<span style={{ fontWeight: 500 }}>Cache Reads:</span>
												<br />
												{formatTiers(modelInfo.pricing?.tiers, "cacheReadsPrice")}
											</div>
										</>
									)}
								</>
							)}
						</div>
					)}

					{/* Provider Routing */}
					{showProviderRouting && onProviderSortingChange && (
						<ProviderRoutingContainer>
							<ProviderRoutingLabel>Provider Routing</ProviderRoutingLabel>
							<VSCodeDropdown
								onChange={(e: any) => onProviderSortingChange(e.target.value)}
								style={{ width: "100%" }}
								value={providerSorting || ""}>
								<VSCodeOption value="">Default</VSCodeOption>
								<VSCodeOption value="price">Price</VSCodeOption>
								<VSCodeOption value="throughput">Throughput</VSCodeOption>
								<VSCodeOption value="latency">Latency</VSCodeOption>
							</VSCodeDropdown>
							<p
								style={{
									fontSize: "11px",
									marginTop: 4,
									marginBottom: 0,
									color: "var(--vscode-descriptionForeground)",
								}}>
								{!providerSorting &&
									"Load balance across providers (AWS, Google Vertex, etc.), prioritizing price while considering uptime"}
								{providerSorting === "price" && "Sort by price, prioritizing the lowest cost provider"}
								{providerSorting === "throughput" &&
									"Sort by throughput, prioritizing highest throughput (may increase cost)"}
								{providerSorting === "latency" && "Sort by response time, prioritizing lowest latency"}
							</p>
						</ProviderRoutingContainer>
					)}
				</AdvancedSection>
			</CollapsibleContent>
		</div>
	)
}
