import { ANTHROPIC_FAST_MODE_SUFFIX, CLAUDE_SONNET_1M_SUFFIX } from "@shared/api"
import { type ModelInfo } from "@shared/proto/dline/models"
import type { ModelCapabilities, ModelPricing } from "@shared/proto/dline/models/metadata"
import type { ApiProfile } from "@shared/proto/dline/profile"
import { AnthropicProviderConfig } from "@shared/proto/dline/provider/anthropic"
import { buildEffectiveModelInfo, mergeCapabilities, mergePricing } from "@shared/providers/effective-model-info"
import { isClaudeOpusAdaptiveThinkingModel } from "@shared/utils/reasoning-support"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useMemo, useState } from "react"
import styled from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ContextWindowSwitcher } from "../common/ContextWindowSwitcher"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelConfiguration } from "../common/ModelConfiguration"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { RemotelyConfiguredInputWrapper } from "../common/RemotelyConfiguredInputWrapper"
import ThinkingControl from "../ThinkingControl"
import { useProviderModels } from "./useProviderModels"

// Anthropic models that support thinking/reasoning mode (extended thinking with budget)
export const SUPPORTED_ANTHROPIC_THINKING_MODELS = ["claude-sonnet-4-6", `claude-sonnet-4-6${CLAUDE_SONNET_1M_SUFFIX}`]

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

	// Auto-discover context window variant pairs
	const contextWindowPairs = useMemo(() => {
		const pairs: Array<{ base200k: string; base1m: string }> = []
		const processedBase200k = new Set<string>()

		for (const id of Object.keys(anthropicModels)) {
			// Skip if already processed or is a 1m variant
			if (processedBase200k.has(id) || id.includes(CLAUDE_SONNET_1M_SUFFIX)) {
				continue
			}

			// Case 1: Normal variant (id → id:1m), excluding :fast models
			if (!id.endsWith(ANTHROPIC_FAST_MODE_SUFFIX)) {
				const variant = `${id}${CLAUDE_SONNET_1M_SUFFIX}`
				if (anthropicModels[variant]) {
					pairs.push({ base200k: id, base1m: variant })
					processedBase200k.add(id)
				}
			}

			// Case 2: Fast mode variant (id:fast → id:1m:fast)
			if (id.endsWith(ANTHROPIC_FAST_MODE_SUFFIX)) {
				const base = id.slice(0, -ANTHROPIC_FAST_MODE_SUFFIX.length)
				const variant = `${base}${CLAUDE_SONNET_1M_SUFFIX}${ANTHROPIC_FAST_MODE_SUFFIX}`
				if (anthropicModels[variant]) {
					pairs.push({ base200k: id, base1m: variant })
					processedBase200k.add(id)
				}
			}
		}

		return pairs
	}, [anthropicModels])

	const pc = profile.anthropic ?? AnthropicProviderConfig.create()
	const modelId = profile.modelId || anthropicDefaultModelId
	const customModelEnabled = pc?.customModelEnabled ?? false
	const registryModel = anthropicModels[modelId] ?? anthropicModelInfoSaneDefaults
	const modelInfo = buildEffectiveModelInfo(modelId, registryModel, {
		capabilities: pc.capabilities,
		pricing: pc.pricing,
	})

	const [useCustomModel, setUseCustomModel] = useState(customModelEnabled)

	const isAdaptiveThinkingModel = isClaudeOpusAdaptiveThinkingModel(modelId)

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
	const handlePricingUpdate = (updates: Partial<ModelPricing>) => {
		onUpdate({
			anthropic: {
				...pc,
				pricing: mergePricing(pc.pricing, updates),
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

							{/* Dynamic context window switchers */}
							{contextWindowPairs.map((pair) => (
								<ContextWindowSwitcher
									base1mModelId={pair.base1m}
									base200kModelId={pair.base200k}
									key={pair.base200k}
									onModelChange={handleModelChange}
									selectedModelId={modelId}
								/>
							))}
						</>
					)}

					{/* ThinkingControl - for predefined models only (custom model has it in CustomModelConfig) */}
					{!useCustomModel && isAdaptiveThinkingModel ? (
						<ThinkingControl
							effortDescription="Use None to disable adaptive thinking. Higher effort increases response detail and token usage."
							effortLabel="Adaptive Thinking"
							effortOptions={["none", "low", "medium", "high", "xhigh"]}
							mode="effort-only"
							onReasoningConfigUpdate={(reasoning) => {
								onUpdate({ anthropic: { ...pc, reasoning } })
							}}
							reasoningConfig={pc.reasoning}
						/>
					) : SUPPORTED_ANTHROPIC_THINKING_MODELS.includes(modelId) ? (
						<ThinkingControl
							budgetLabel="Thinking Budget"
							maxBudget={modelInfo.capabilities?.thinking?.maxBudget}
							mode="budget-only"
							onReasoningConfigUpdate={(reasoning) => {
								onUpdate({ anthropic: { ...pc, reasoning } })
							}}
							reasoningConfig={pc.reasoning}
						/>
					) : null}

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
					effortOptions={["none", "low", "medium", "high", "xhigh"]}
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

			{/* ModelConfiguration component */}
			<ModelConfiguration
				capabilities={capabilities}
				defaults={defaults}
				fields={{
					capabilities: ["maxTokens", "contextWindow", "supportsImages", "supportsPromptCache"],
					pricing: ["inputPrice", "outputPrice", "cacheWritesPrice", "cacheReadsPrice"],
				}}
				onCapabilitiesUpdate={onCapabilitiesUpdate}
				onPricingUpdate={onPricingUpdate}
				pricing={pricing}
			/>
		</>
	)
}
