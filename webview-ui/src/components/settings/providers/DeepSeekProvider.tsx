import type { ModelInfo } from "@shared/proto/dline/models"
import { ApiFormat, ServerTool } from "@shared/proto/dline/models/metadata"
import type { ReasoningConfig } from "@shared/proto/dline/provider/common"
import { BaseProviderConfig } from "@shared/proto/dline/provider/common"
import { resolveApiFormat } from "@shared/providers/api-format"
import { resolveProfileModelInfo } from "@shared/providers/profile-model-info"
import { DEEPSEEK_REASONING_EFFORT_OPTIONS, resolveDeepSeekAdaptiveThinking } from "@shared/utils/reasoning-support"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useRef, useState } from "react"
import { ApiFormatSelector } from "../common/ApiFormatSelector"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelAutocomplete } from "../common/ModelAutocomplete"
import { ModelInfoView } from "../common/ModelInfoView"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import type { ApiProfile } from "./ProviderProfile"
import { ProviderWebSearchSettings } from "./ProviderWebSearchSettings"
import { useProviderModelOptions } from "./useProviderModelOptions"

/**
 * Props for the DeepSeekProvider component
 */
interface DeepSeekProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	profile: ApiProfile
	onUpdate: (updates: Partial<ApiProfile>) => void
}

/**
 * The DeepSeek provider configuration component.
 * All data sourced from ApiProfile.
 * Reasoning effort stored in deepseek.
 */
export const DeepSeekProvider = ({ showModelOptions, isPopup, profile, onUpdate }: DeepSeekProviderProps) => {
	const {
		models: deepSeekModels,
		defaultModelId: deepSeekDefaultModelId,
		options: deepSeekModelOptions,
		refreshRemoteModels,
	} = useProviderModelOptions({
		providerId: "deepseek",
		baseUrl: profile.baseUrl,
		apiKey: profile.apiKey,
		selectedModelId: profile.modelId,
	})

	const modelId = profile.modelId || deepSeekDefaultModelId
	const pc = profile.deepseek ?? BaseProviderConfig.create()
	const modelInfo: ModelInfo = resolveProfileModelInfo(profile, {
		models: deepSeekModels,
		defaultModelId: deepSeekDefaultModelId,
	})
	const selectedApiFormat = resolveApiFormat(pc.apiFormat, modelInfo, ApiFormat.OPENAI_CHAT)
	const hostedWebSearchAvailable =
		modelInfo.capabilities?.tools?.includes(ServerTool.WEB_SEARCH) === true &&
		(selectedApiFormat === ApiFormat.OPENAI_RESPONSES || selectedApiFormat === ApiFormat.ANTHROPIC_CHAT)

	// DeepSeek thinking is enabled only by the explicit Profile flag.
	const reasoningConfig = profile.deepseek?.reasoning
	const profileEffort = reasoningConfig?.effort ?? ""
	const supportsThinking = modelInfo?.capabilities?.supportsReasoning ?? false
	const [enableThinking, setEnableThinking] = useState(reasoningConfig?.enableThinking === true)
	const adaptiveThinking = resolveDeepSeekAdaptiveThinking(profileEffort)
	const savedEffortRef = useRef<string>(profileEffort || "high")

	useEffect(() => {
		setEnableThinking(reasoningConfig?.enableThinking === true)
	}, [reasoningConfig?.enableThinking])

	const persistReasoning = (reasoning: ReasoningConfig) => {
		const base = profile.deepseek ?? BaseProviderConfig.create()
		onUpdate({
			deepseek: {
				...base,
				reasoning,
			},
		})
	}

	const persistEffort = (value: string) => {
		savedEffortRef.current = value || savedEffortRef.current || "high"
		persistReasoning({
			enableThinking: true,
			effort: value,
		})
	}

	return (
		<div>
			<ApiKeyField
				initialValue={profile.apiKey}
				onChange={(value) => onUpdate({ apiKey: value })}
				providerName="DeepSeek"
				signupUrl="https://www.deepseek.com/"
			/>

			{showModelOptions && (
				<>
					<ModelAutocomplete
						label="Model"
						models={deepSeekModelOptions}
						onChange={(newModelId) => {
							// Only catalog entries carry metadata; a discovered id keeps
							// the profile's existing model info untouched.
							const nextModel = deepSeekModels[newModelId]
							onUpdate({
								modelId: newModelId,
								...(nextModel ? { modelInfo: nextModel } : {}),
								deepseek: {
									...pc,
									apiFormat: resolveApiFormat(pc.apiFormat, nextModel, ApiFormat.OPENAI_CHAT),
								},
							})
						}}
						onOpen={refreshRemoteModels}
						placeholder="Search and select a model..."
						selectedModelId={modelId}
					/>

					<ApiFormatSelector
						apiFormats={modelInfo?.apiFormats}
						fallbackApiFormat={ApiFormat.OPENAI_CHAT}
						onChange={(apiFormat) => onUpdate({ deepseek: { ...pc, apiFormat } })}
						selectedApiFormat={selectedApiFormat}
					/>

					<ProviderWebSearchSettings
						hostedAvailable={hostedWebSearchAvailable}
						onChange={(webSearchMode) => onUpdate({ webSearchMode })}
						value={profile.webSearchMode}
					/>

					{supportsThinking ? (
						<>
							<div style={{ marginTop: 8 }}>
								<VSCodeCheckbox
									checked={enableThinking}
									onChange={(e: any) => {
										const checked = e.target.checked === true
										const prevEffort = profileEffort || savedEffortRef.current || "high"
										setEnableThinking(checked)
										if (checked) {
											savedEffortRef.current = prevEffort
											persistReasoning({ enableThinking: true, effort: prevEffort })
										} else {
											persistReasoning({ enableThinking: false })
										}
									}}>
									Enable Thinking
								</VSCodeCheckbox>
							</div>
							{enableThinking && (
								<ReasoningEffortSelector
									allowedEfforts={DEEPSEEK_REASONING_EFFORT_OPTIONS}
									defaultEffort={adaptiveThinking.effort ?? "high"}
									description="Toggle above to enable thinking. Low uses less reasoning; High is the standard level; Max is for complex tasks."
									label="Thinking Level"
									onReasoningEffortChange={persistEffort}
									reasoningEffort={profileEffort}
								/>
							)}
						</>
					) : null}

					<ModelInfoView isPopup={isPopup} modelInfo={modelInfo} selectedModelId={modelId} />
				</>
			)}
		</div>
	)
}
