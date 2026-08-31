import { type ModelInfo } from "@shared/proto/dline/models"
import type { ModelCapabilities, ModelPricing } from "@shared/proto/dline/models/metadata"
import type { ApiProfile } from "@shared/proto/dline/profile"
import { AnthropicProviderConfig } from "@shared/proto/dline/provider/anthropic"
import {
	buildEffectiveModelInfo,
	mergeCapabilities,
	mergePricing,
	selectContextTier,
	updateSelectedContextWindow,
} from "@shared/providers/effective-model-info"
import {
	ANTHROPIC_ADAPTIVE_REASONING_EFFORT_OPTIONS,
	canDisableClaudeAdaptiveThinking,
	isClaudeAdaptiveThinkingEnabledByDefault,
} from "@shared/utils/reasoning-support"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import styled from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelConfiguration } from "../common/ModelConfiguration"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { RemotelyConfiguredInputWrapper } from "../common/RemotelyConfiguredInputWrapper"
import ThinkingControl from "../ThinkingControl"
import { useProviderModels } from "./useProviderModels"

const StyledCheckbox = styled(VSCodeCheckbox)`
	margin-bottom: 4px;
`

/**
 * Props for the AnthropicProvider component
 */
interface AnthropicProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	profile: ApiProfile
	onUpdate: (updates: Partial<ApiProfile>) => void
}

/**
 * The Anthropic provider configuration component.
 * All data sourced from ApiProfile.anthropic (the proto oneof field) â€? * typed as AnthropicProviderConfig | undefined, no unsafe casts.
 */
export const AnthropicProvider = ({ showModelOptions, isPopup, profile, onUpdate }: AnthropicProviderProps) => {
	const { remoteConfigSettings } = useExtensionState()
	const rc: Partial<Record<string, string | number | boolean>> =
		(remoteConfigSettings as Record<string, string | number | boolean>) ?? {}

	const {
		models: anthropicModels,
		defaultModelId: anthropicDefaultModelId,
		modelInfoSaneDefaults: anthropicModelInfoSaneDefaults,
	} = useProviderModels("anthropic")

	const pc = profile.anthropic ?? AnthropicProviderConfig.create()
	const modelId = profile.modelId || anthropicDefaultModelId
	const customModelEnabled = pc?.customModelEnabled ?? false
	const registryModel = anthropicModels[modelId] ?? anthropicModelInfoSaneDefaults
	const contextWindowTiersEnabled = customModelEnabled || Boolean(registryModel.capabilities?.contextWindowTiers?.length)
	// The 1M long-context option is enabled by default; only an explicit false disables it.
	const enableLongContext = pc.enableLongContext !== false
	const modelInfo = buildEffectiveModelInfo(modelId, registryModel, {
		capabilities: pc.capabilities,
		pricing: pc.pricing,
		enableLongContext,
		pricingTiersEnabled: pc.pricingTiersEnabled,
		preferContextWindowTier: true,
		contextWindowTiersEnabled,
	})
	const selectedContextTier = selectContextTier(modelInfo.capabilities, enableLongContext)
	const contextWindowValue = selectedContextTier?.contextWindow ?? modelInfo.capabilities?.contextWindow

	const [useCustomModel, setUseCustomModel] = useState(customModelEnabled)

	const adaptiveEffortOptions = modelInfo.capabilities?.thinking?.effortLevels ?? []
	const isAdaptiveThinkingModel =
		modelInfo.capabilities?.thinking?.supported === true &&
		modelInfo.capabilities.thinking.mode === "effort" &&
		adaptiveEffortOptions.length > 0
	const adaptiveThinkingDefaultEnabled = !useCustomModel && isClaudeAdaptiveThinkingEnabledByDefault(modelId)
	const adaptiveThinkingDisableSupported = useCustomModel || canDisableClaudeAdaptiveThinking(modelId)

	// --- Handlers ---
	const handleModelChange = (newModelId: string) => {
		onUpdate({ modelId: newModelId })
	}

	// Update provider capabilities without writing profile.modelInfo.
	const handleCapabilitiesUpdate = (updates: Partial<ModelCapabilities>) => {
		onUpdate({
			anthropic: {
				...pc,
				capabilities: mergeCapabilities(pc.capabilities, updates),
			},
		})
	}

	// Update provider pricing without writing profile.modelInfo.
	const handleContextWindowUpdate = (contextWindow: number) => {
		onUpdate({
			anthropic: {
				...pc,
				capabilities: updateSelectedContextWindow(
					registryModel.capabilities,
					pc.capabilities,
					enableLongContext,
					contextWindow,
					contextWindowTiersEnabled,
				),
			},
		})
	}

	const handlePricingUpdate = (updates: Partial<ModelPricing>) => {
		onUpdate({
			anthropic: {
				...pc,
				pricing: mergePricing(pc.pricing, updates),
				...(updates.tiers === undefined ? {} : { pricingTiersEnabled: true }),
			},
		})
	}

	const handleToggleCustomModel = (checked: boolean) => {
		setUseCustomModel(checked)
		const newModelId = checked ? modelId || "custom-model" : Object.keys(anthropicModels)[0]
		onUpdate({
			modelId: newModelId,
			anthropic: {
				...pc,
				customModelEnabled: checked,
			},
		})
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
			<ApiKeyField
				initialValue={profile.apiKey}
				onChange={(value) => onUpdate({ apiKey: value })}
				providerName="Anthropic"
				signupUrl="https://console.anthropic.com/settings/keys"
			/>

			<RemotelyConfiguredInputWrapper hidden={rc.anthropicBaseUrl === undefined}>
				<BaseUrlField
					disabled={!!rc.anthropicBaseUrl}
					initialValue={profile.baseUrl || ""}
					label="Use custom base URL"
					onChange={(value) => onUpdate({ baseUrl: value || undefined })}
					placeholder="Default: https://api.anthropic.com"
					showLockIcon={!!rc.anthropicBaseUrl}
				/>
			</RemotelyConfiguredInputWrapper>

			{showModelOptions && (
				<>
					<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
						<StyledCheckbox
							checked={useCustomModel}
							onChange={(e: Event | React.FormEvent<HTMLElement>) =>
								handleToggleCustomModel((e.target as HTMLInputElement | null)?.checked === true)
							}>
							Use custom model ID
						</StyledCheckbox>
					</div>

					{useCustomModel ? (
						<CustomModelConfig
							capabilities={pc.capabilities}
							defaults={anthropicModelInfoSaneDefaults}
							modelId={modelId}
							modelInfo={modelInfo}
							onCapabilitiesUpdate={handleCapabilitiesUpdate}
							onContextWindowUpdate={handleContextWindowUpdate}
							onModelIdChange={handleModelChange}
							onPricingUpdate={handlePricingUpdate}
							onUpdate={onUpdate}
							pc={pc}
							pricing={pc.pricing}
						/>
					) : (
						<>
							<ModelSelector
								label="Model"
								models={anthropicModels}
								onChange={(e) => handleModelChange((e.target as HTMLSelectElement).value)}
								selectedModelId={modelId}
							/>

							{modelInfo.capabilities?.contextWindowTiers?.length ? (
								<StyledCheckbox
									checked={pc.enableLongContext !== false}
									onChange={(event: Event | React.FormEvent<HTMLElement>) =>
										onUpdate({
											anthropic: {
												...pc,
												enableLongContext: (event.target as HTMLInputElement | null)?.checked === true,
											},
										})
									}>
									Enable Long Context
								</StyledCheckbox>
							) : null}

							<ModelConfiguration
								capabilities={pc.capabilities}
								contextWindowValue={contextWindowValue}
								defaults={registryModel}
								fields={{
									capabilities: [
										"maxTokens",
										"contextWindow",
										...(contextWindowTiersEnabled ? (["contextWindowTiers"] as const) : []),
										"supportsImages",
										"supportsWebSearch",
										"supportsBrowserAction",
										"supportsPromptCache",
										"supportsTools",
									],
									pricing: ["inputPrice", "outputPrice", "cacheWritesPrice", "cacheReadsPrice", "pricingTiers"],
								}}
								onCapabilitiesUpdate={handleCapabilitiesUpdate}
								onContextWindowUpdate={handleContextWindowUpdate}
								onPricingUpdate={handlePricingUpdate}
								pricing={pc.pricing}
								pricingTiersEnabled={pc.pricingTiersEnabled === true}
								// Official models show registry tiers editable; custom models can add their own tiers.
								tiersEditable={true}
							/>
						</>
					)}

					{/* ThinkingControl - for predefined models only (custom model has it in CustomModelConfig) */}
					{!useCustomModel && isAdaptiveThinkingModel && (
						<ThinkingControl
							defaultEnabled={adaptiveThinkingDefaultEnabled}
							defaultEffort={adaptiveThinkingDefaultEnabled ? "high" : undefined}
							disableSupported={adaptiveThinkingDisableSupported}
							effortDescription={
								adaptiveThinkingDisableSupported
									? "Use None to disable adaptive thinking. Higher effort increases response detail and token usage."
									: "Adaptive thinking is always enabled for this model. Higher effort increases response detail and token usage."
							}
							effortLabel="Adaptive Thinking"
							effortOptions={adaptiveEffortOptions}
							mode="effort-only"
							onReasoningConfigUpdate={(reasoning) => {
								onUpdate({ anthropic: { ...pc, reasoning } })
							}}
							reasoningConfig={pc.reasoning}
						/>
					)}

					<ModelInfoView isPopup={isPopup} modelInfo={modelInfo} selectedModelId={modelId} />
				</>
			)}
		</div>
	)
}

interface CustomModelConfigProps {
	modelId: string
	modelInfo: ModelInfo
	defaults: Partial<ModelInfo>
	capabilities?: ModelCapabilities
	pricing?: ModelPricing
	pc: AnthropicProviderConfig
	onModelIdChange: (modelId: string) => void
	onCapabilitiesUpdate: (updates: Partial<ModelCapabilities>) => void
	onContextWindowUpdate: (contextWindow: number) => void
	onPricingUpdate: (updates: Partial<ModelPricing>) => void
	onUpdate: (updates: Partial<ApiProfile>) => void
}

const CustomModelConfig = ({
	modelId,
	modelInfo,
	defaults,
	capabilities,
	pricing,
	pc,
	onModelIdChange,
	onCapabilitiesUpdate,
	onContextWindowUpdate,
	onPricingUpdate,
	onUpdate,
}: CustomModelConfigProps) => {
	return (
		<>
			<DebouncedTextField
				initialValue={modelId || ""}
				onChange={(value) => onModelIdChange(value)}
				placeholder="deepseek-v4-pro"
				style={{ width: "100%", marginBottom: 8 }}>
				<span style={{ fontWeight: 500 }}>Model ID</span>
			</DebouncedTextField>

			{/* ThinkingControl - placed before ModelConfiguration */}
			{modelInfo?.capabilities?.supportsReasoning && (
				<ThinkingControl
					effortDescription="Use None to disable adaptive thinking. Higher effort increases response detail and token usage."
					effortLabel="Adaptive Thinking"
					effortOptions={
						(modelInfo.capabilities?.thinking?.effortLevels?.length ?? 0) > 0
							? modelInfo.capabilities.thinking?.effortLevels
							: ANTHROPIC_ADAPTIVE_REASONING_EFFORT_OPTIONS
					}
					maxBudget={modelInfo?.capabilities?.thinking?.maxBudget}
					mode="both"
					modeSelectorLabel="Thinking Mode"
					modeSelectorOptions={[
						{ value: "effort", label: "Effort" },
						{ value: "budget", label: "Budget" },
					]}
					onReasoningConfigUpdate={(reasoning) => {
						onUpdate({ anthropic: { ...pc, reasoning } })
					}}
					reasoningConfig={pc.reasoning}
					showModeSelector={true}
				/>
			)}

			{modelInfo.capabilities?.contextWindowTiers?.length ? (
				<StyledCheckbox
					checked={pc.enableLongContext !== false}
					onChange={(event: Event | React.FormEvent<HTMLElement>) =>
						onUpdate({
							anthropic: {
								...pc,
								enableLongContext: (event.target as HTMLInputElement | null)?.checked === true,
							},
						})
					}>
					Enable Long Context
				</StyledCheckbox>
			) : null}

			{/* ModelConfiguration component */}
			<ModelConfiguration
				capabilities={capabilities}
				contextWindowValue={
					selectContextTier(modelInfo.capabilities, pc.enableLongContext !== false)?.contextWindow ??
					modelInfo.capabilities?.contextWindow
				}
				defaults={defaults}
				fields={{
					capabilities: [
						"maxTokens",
						"contextWindow",
						"contextWindowTiers",
						"supportsImages",
						"supportsWebSearch",
						"supportsBrowserAction",
						"supportsPromptCache",
						"supportsTools",
					],
					pricing: ["inputPrice", "outputPrice", "cacheWritesPrice", "cacheReadsPrice", "pricingTiers"],
				}}
				onCapabilitiesUpdate={onCapabilitiesUpdate}
				onContextWindowUpdate={onContextWindowUpdate}
				onPricingUpdate={onPricingUpdate}
				pricing={pricing}
				pricingTiersEnabled={pc.pricingTiersEnabled === true}
				tiersEditable={true}
			/>
		</>
	)
}
