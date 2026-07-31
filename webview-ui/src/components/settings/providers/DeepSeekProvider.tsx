import type { ModelInfo } from "@shared/proto/dline/models"
import { ApiFormat } from "@shared/proto/dline/models/metadata"
import { BaseProviderConfig } from "@shared/proto/dline/provider/common"
import { resolveApiFormat } from "@shared/providers/api-format"
import { DEEPSEEK_REASONING_EFFORT_OPTIONS, resolveDeepSeekAdaptiveThinking } from "@shared/utils/reasoning-support"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useRef, useState } from "react"
import { ApiFormatSelector } from "../common/ApiFormatSelector"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import type { ApiProfile } from "./ProviderProfile"
import { useProviderModels } from "./useProviderModels"

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
		modelInfoSaneDefaults: deepSeekModelInfoSaneDefaults,
	} = useProviderModels("deepseek")

	const modelId = profile.modelId || deepSeekDefaultModelId
	const pc = profile.deepseek ?? BaseProviderConfig.create()
	const modelInfo: ModelInfo | undefined =
		profile.modelInfo ?? (profile.modelId ? deepSeekModels[profile.modelId] : undefined) ?? deepSeekModelInfoSaneDefaults

	// Reasoning effort from deepseek
	const profileEffort = profile.deepseek?.reasoning?.effort ?? ""

	const supportsThinking = modelInfo?.capabilities?.supportsReasoning ?? false
	const [enableThinking, setEnableThinking] = useState(!!profileEffort)
	const adaptiveThinking = resolveDeepSeekAdaptiveThinking(profileEffort)
	const savedEffortRef = useRef<string>(profileEffort || "high")

	useEffect(() => {
		setEnableThinking(!!profileEffort)
	}, [profileEffort])

	// Persist reasoning effort to deepseek
	const persistEffort = (value: string) => {
		const base = profile.deepseek ?? BaseProviderConfig.create()
		onUpdate({
			deepseek: {
				...base,
				reasoning: { effort: value, thinkingBudget: base.reasoning?.thinkingBudget ?? 0 },
			},
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
					<ModelSelector
						label="Model"
						models={deepSeekModels}
						onChange={(e: any) => {
							const newModelId = e.target.value
							const nextModel = deepSeekModels[newModelId]
							onUpdate({
								modelId: newModelId,
								modelInfo: nextModel,
								deepseek: {
									...pc,
									apiFormat: resolveApiFormat(pc.apiFormat, nextModel, ApiFormat.OPENAI_CHAT),
								},
							})
						}}
						selectedModelId={modelId}
					/>

					<ApiFormatSelector
						apiFormats={modelInfo?.apiFormats}
						fallbackApiFormat={ApiFormat.OPENAI_CHAT}
						onChange={(apiFormat) => onUpdate({ deepseek: { ...pc, apiFormat } })}
						selectedApiFormat={pc.apiFormat}
					/>

					{supportsThinking ? (
						<>
							<div style={{ marginTop: 8 }}>
								<VSCodeCheckbox
									checked={enableThinking}
									onChange={(e: any) => {
										const checked = e.target.checked === true
										setEnableThinking(checked)
										const prevEffort = profileEffort || savedEffortRef.current
										if (checked) savedEffortRef.current = prevEffort
										persistEffort(checked ? prevEffort : "")
									}}>
									Enable Thinking
								</VSCodeCheckbox>
							</div>
							{enableThinking && (
								<ReasoningEffortSelector
									allowedEfforts={DEEPSEEK_REASONING_EFFORT_OPTIONS}
									defaultEffort={adaptiveThinking.effort ?? "high"}
									description="Toggle above to enable thinking. High is the standard level; Max is for complex tasks."
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
