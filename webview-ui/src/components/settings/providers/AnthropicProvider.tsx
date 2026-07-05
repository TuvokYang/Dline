import { ANTHROPIC_FAST_MODE_SUFFIX, CLAUDE_SONNET_1M_SUFFIX } from "@shared/api"
import { type ModelInfo } from "@shared/proto/dline/models"
import { ModelCapabilities, ModelPricing } from "@shared/proto/dline/models/metadata"
import type { ApiProfile } from "@shared/proto/dline/profile"
import { AnthropicProviderConfig } from "@shared/proto/dline/provider/anthropic"
import { isClaudeOpusAdaptiveThinkingModel, resolveClaudeOpusAdaptiveThinking } from "@shared/utils/reasoning-support"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import styled from "styled-components"
import { Label } from "@/components/ui/label"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ContextWindowSwitcher } from "../common/ContextWindowSwitcher"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { RemotelyConfiguredInputWrapper } from "../common/RemotelyConfiguredInputWrapper"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { buildCustomModelInfo } from "./anthropicCustomModel"
import { useProviderModels } from "./useProviderModels"

// Anthropic models that support thinking/reasoning mode
export const SUPPORTED_ANTHROPIC_THINKING_MODELS = [
	"claude-sonnet-4-6",
	`claude-sonnet-4-6${CLAUDE_SONNET_1M_SUFFIX}`,
	"claude-3-7-sonnet-20250219",
	"claude-sonnet-4-20250514",
	`claude-sonnet-4-20250514${CLAUDE_SONNET_1M_SUFFIX}`,
	"claude-opus-4-20250514",
	"claude-opus-4-1-20250805",
	"claude-sonnet-4-5-20250929",
	`claude-sonnet-4-5-20250929${CLAUDE_SONNET_1M_SUFFIX}`,
	"claude-haiku-4-5-20251001",
]

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
	const customModelInfo: ModelInfo | null = pc?.customModelEnabled
		? buildCustomModelInfo({
				modelId,
				defaults: anthropicModelInfoSaneDefaults,
				current: profile.modelInfo,
				capabilities: pc.capabilities,
				pricing: pc.pricing,
			})
		: null
	const modelInfo = customModelInfo ?? profile.modelInfo ?? anthropicModels[modelId] ?? anthropicModelInfoSaneDefaults
	const reasoningEffort = pc?.reasoning?.effort ?? ""
	const thinkingBudgetTokens = pc?.reasoning?.thinkingBudget ?? 0

	const [useCustomModel, setUseCustomModel] = useState(customModelEnabled)
	const [enableAdaptiveThinking, setEnableAdaptiveThinking] = useState(!!reasoningEffort)

	const isAdaptiveThinkingModel = isClaudeOpusAdaptiveThinkingModel(modelId)
	const adaptiveThinkingDefaultEffort =
		resolveClaudeOpusAdaptiveThinking(reasoningEffort, thinkingBudgetTokens).effort ?? "none"

	useEffect(() => {
		setEnableAdaptiveThinking(!!reasoningEffort)
	}, [reasoningEffort])

	// --- Handlers ---
	const handleModelChange = (newModelId: string) => {
		if (useCustomModel) {
			onUpdate({
				modelId: newModelId,
				modelInfo: buildCustomModelInfo({
					modelId: newModelId,
					defaults: anthropicModelInfoSaneDefaults,
					current: customModelInfo ?? profile.modelInfo,
					capabilities: pc.capabilities,
					pricing: pc.pricing,
				}),
			})
			return
		}

		onUpdate({ modelId: newModelId, modelInfo: anthropicModels[newModelId] })
	}

	const handleCustomModelInfoChange = (field: string, value: string | number | boolean) => {
		const capFields = new Set(["maxTokens", "contextWindow", "supportsImages", "supportsPromptCache", "supportsReasoning"])
		if (capFields.has(field)) {
			const caps = pc.capabilities ?? ModelCapabilities.fromPartial({})
			const nextCapabilities = { ...caps, [field]: value as never }
			onUpdate({
				modelInfo: buildCustomModelInfo({
					modelId,
					defaults: anthropicModelInfoSaneDefaults,
					current: customModelInfo ?? profile.modelInfo,
					capabilities: nextCapabilities,
					pricing: pc.pricing,
				}),
				anthropic: { ...pc, capabilities: nextCapabilities },
			})
		} else {
			const prc = pc.pricing ?? ModelPricing.fromPartial({})
			const nextPricing = { ...prc, [field]: value as never }
			onUpdate({
				modelInfo: buildCustomModelInfo({
					modelId,
					defaults: anthropicModelInfoSaneDefaults,
					current: customModelInfo ?? profile.modelInfo,
					capabilities: pc.capabilities,
					pricing: nextPricing,
				}),
				anthropic: { ...pc, pricing: nextPricing },
			})
		}
	}

	const handleToggleCustomModel = (checked: boolean) => {
		setUseCustomModel(checked)
		const newModelId = checked ? modelId || "custom-model" : Object.keys(anthropicModels)[0]
		const newModelInfo = checked
			? buildCustomModelInfo({
					modelId: newModelId,
					defaults: anthropicModelInfoSaneDefaults,
					current: customModelInfo ?? modelInfo,
					capabilities: pc.capabilities,
					pricing: pc.pricing,
				})
			: undefined
		onUpdate({
			modelId: newModelId,
			modelInfo: newModelInfo,
			anthropic: {
				...pc,
				customModelEnabled: checked,
			},
		})
	}

	const persistEffort = (value: string) => {
		onUpdate({ anthropic: { ...pc, reasoning: { effort: value, thinkingBudget: pc.reasoning?.thinkingBudget ?? 0 } } })
	}

	const displayCustomModelInfo: ModelInfo = customModelInfo ?? anthropicModelInfoSaneDefaults

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
							defaults={anthropicModelInfoSaneDefaults}
							modelId={modelId}
							modelInfo={displayCustomModelInfo}
							onModelIdChange={handleModelChange}
							onModelInfoChange={handleCustomModelInfoChange}
						/>
					) : (
						<>
							<ModelSelector
								label="Model"
								models={anthropicModels}
								onChange={(e) => handleModelChange((e.target as HTMLSelectElement).value)}
								selectedModelId={modelId}
							/>

							<ContextWindowSwitcher
								base1mModelId={`claude-opus-4-6${CLAUDE_SONNET_1M_SUFFIX}`}
								base200kModelId="claude-opus-4-6"
								onModelChange={handleModelChange}
								selectedModelId={modelId}
							/>

							<ContextWindowSwitcher
								base1mModelId={`claude-opus-4-6${CLAUDE_SONNET_1M_SUFFIX}${ANTHROPIC_FAST_MODE_SUFFIX}`}
								base200kModelId={`claude-opus-4-6${ANTHROPIC_FAST_MODE_SUFFIX}`}
								onModelChange={handleModelChange}
								selectedModelId={modelId}
							/>

							<ContextWindowSwitcher
								base1mModelId={`claude-sonnet-4-6${CLAUDE_SONNET_1M_SUFFIX}`}
								base200kModelId="claude-sonnet-4-6"
								onModelChange={handleModelChange}
								selectedModelId={modelId}
							/>

							<ContextWindowSwitcher
								base1mModelId={`claude-sonnet-4-5-20250929${CLAUDE_SONNET_1M_SUFFIX}`}
								base200kModelId="claude-sonnet-4-5-20250929"
								onModelChange={handleModelChange}
								selectedModelId={modelId}
							/>

							<ContextWindowSwitcher
								base1mModelId={`claude-sonnet-4-20250514${CLAUDE_SONNET_1M_SUFFIX}`}
								base200kModelId="claude-sonnet-4-20250514"
								onModelChange={handleModelChange}
								selectedModelId={modelId}
							/>
						</>
					)}

					{useCustomModel ? (
						<>
							{customModelInfo?.capabilities?.supportsReasoning && (
								<ThinkingBudgetSlider
									maxBudget={customModelInfo.capabilities?.thinking?.maxBudget}
									onThinkingBudgetTokensChange={(v) =>
										onUpdate({
											anthropic: {
												...pc,
												reasoning: { effort: pc.reasoning?.effort ?? "", thinkingBudget: v },
											},
										})
									}
									thinkingBudgetTokens={pc.reasoning?.thinkingBudget ?? 0}
								/>
							)}
							{customModelInfo?.capabilities?.supportsReasoning && (
								<>
									<div style={{ marginTop: 8 }}>
										<VSCodeCheckbox
											checked={enableAdaptiveThinking}
											onChange={(e: Event | React.FormEvent<HTMLElement>) => {
												const checked = (e.target as HTMLInputElement | null)?.checked === true
												setEnableAdaptiveThinking(checked)
												persistEffort(checked ? reasoningEffort || "medium" : "")
											}}>
											Enable Adaptive Thinking
										</VSCodeCheckbox>
									</div>
									{enableAdaptiveThinking && (
										<ReasoningEffortSelector
											allowedEfforts={["none", "low", "medium", "high", "xhigh"] as const}
											defaultEffort={adaptiveThinkingDefaultEffort}
											description="Use None to disable adaptive thinking. Higher effort increases response detail and token usage."
											label="Adaptive Thinking"
											onReasoningEffortChange={(v) =>
												onUpdate({
													anthropic: {
														...pc,
														reasoning: {
															effort: v,
															thinkingBudget: pc.reasoning?.thinkingBudget ?? 0,
														},
													},
												})
											}
											reasoningEffort={pc.reasoning?.effort}
										/>
									)}
								</>
							)}
						</>
					) : isAdaptiveThinkingModel ? (
						<ReasoningEffortSelector
							allowedEfforts={["none", "low", "medium", "high", "xhigh"] as const}
							defaultEffort={adaptiveThinkingDefaultEffort}
							description="Use None to disable adaptive thinking. Higher effort increases response detail and token usage."
							label="Adaptive Thinking"
							onReasoningEffortChange={(v) =>
								onUpdate({
									anthropic: {
										...pc,
										reasoning: { effort: v, thinkingBudget: pc.reasoning?.thinkingBudget ?? 0 },
									},
								})
							}
							reasoningEffort={pc.reasoning?.effort}
						/>
					) : SUPPORTED_ANTHROPIC_THINKING_MODELS.includes(modelId) ? (
						<ThinkingBudgetSlider
							maxBudget={modelInfo.capabilities?.thinking?.maxBudget}
							onThinkingBudgetTokensChange={(v) =>
								onUpdate({
									anthropic: { ...pc, reasoning: { effort: pc.reasoning?.effort ?? "", thinkingBudget: v } },
								})
							}
							thinkingBudgetTokens={pc.reasoning?.thinkingBudget ?? 0}
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
	onModelIdChange: (id: string) => void
	onModelInfoChange: (field: string, value: string | number | boolean) => void
}

const CustomModelConfig = ({ modelId, modelInfo, defaults, onModelIdChange, onModelInfoChange }: CustomModelConfigProps) => {
	return (
		<div style={{ marginBottom: 8 }}>
			<DebouncedTextField
				initialValue={modelId || ""}
				onChange={(value) => onModelIdChange(value)}
				placeholder="deepseek-v4-pro"
				style={{ width: "100%" }}>
				<span style={{ fontWeight: 500 }}>Model ID</span>
			</DebouncedTextField>

			<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
				<DebouncedTextField
					initialValue={String(modelInfo.capabilities?.maxTokens || 0)}
					onChange={(value) => onModelInfoChange("maxTokens", Number(value) || 0)}
					placeholder={`${defaults.capabilities?.maxTokens ?? 128000}`}
					style={{ flex: 1 }}>
					<span style={{ fontWeight: 500 }}>Max Tokens</span>
				</DebouncedTextField>

				<DebouncedTextField
					initialValue={String(modelInfo.capabilities?.contextWindow || 0)}
					onChange={(value) => onModelInfoChange("contextWindow", Number(value) || 0)}
					placeholder={`${defaults.capabilities?.contextWindow ?? 1000000}`}
					style={{ flex: 1 }}>
					<span style={{ fontWeight: 500 }}>Context Window</span>
				</DebouncedTextField>
			</div>

			<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
				<DebouncedTextField
					initialValue={String(modelInfo.pricing?.inputPrice ?? 0)}
					onChange={(value) => onModelInfoChange("inputPrice", Number(value) || 0)}
					placeholder={`${defaults.pricing?.inputPrice ?? 1}`}
					style={{ flex: 1 }}>
					<span style={{ fontWeight: 500 }}>Input Price ($/M)</span>
				</DebouncedTextField>

				<DebouncedTextField
					initialValue={String(modelInfo.pricing?.outputPrice ?? 0)}
					onChange={(value) => onModelInfoChange("outputPrice", Number(value) || 0)}
					placeholder={`${defaults.pricing?.outputPrice ?? 2}`}
					style={{ flex: 1 }}>
					<span style={{ fontWeight: 500 }}>Output Price ($/M)</span>
				</DebouncedTextField>
			</div>

			<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
				<DebouncedTextField
					initialValue={String(modelInfo.pricing?.cacheWritesPrice ?? 0)}
					onChange={(value) => onModelInfoChange("cacheWritesPrice", Number(value) || 0)}
					placeholder={`${defaults.pricing?.cacheWritesPrice ?? 0}`}
					style={{ flex: 1 }}>
					<span style={{ fontWeight: 500 }}>Cache Writes ($/M)</span>
				</DebouncedTextField>

				<DebouncedTextField
					initialValue={String(modelInfo.pricing?.cacheReadsPrice ?? 0)}
					onChange={(value) => onModelInfoChange("cacheReadsPrice", Number(value) || 0)}
					placeholder={`${defaults.pricing?.cacheReadsPrice ?? 0}`}
					style={{ flex: 1 }}>
					<span style={{ fontWeight: 500 }}>Cache Reads ($/M)</span>
				</DebouncedTextField>
			</div>

			<div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
				<Label className="text-xs font-medium">Options</Label>
				<VSCodeCheckbox
					checked={Boolean(modelInfo.capabilities?.supportsImages ?? false)}
					onChange={(e: Event | React.FormEvent<HTMLElement>) =>
						onModelInfoChange("supportsImages", (e.target as HTMLInputElement | null)?.checked === true)
					}>
					Supports Images
				</VSCodeCheckbox>
				<VSCodeCheckbox
					checked={Boolean(modelInfo.capabilities?.supportsPromptCache ?? true)}
					onChange={(e: Event | React.FormEvent<HTMLElement>) =>
						onModelInfoChange("supportsPromptCache", (e.target as HTMLInputElement | null)?.checked === true)
					}>
					Supports Prompt Cache
				</VSCodeCheckbox>
				<VSCodeCheckbox
					checked={Boolean(modelInfo.capabilities?.supportsReasoning ?? true)}
					onChange={(e: Event | React.FormEvent<HTMLElement>) =>
						onModelInfoChange("supportsReasoning", (e.target as HTMLInputElement | null)?.checked === true)
					}>
					Supports Reasoning
				</VSCodeCheckbox>
			</div>
		</div>
	)
}
