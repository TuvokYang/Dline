// Mode import removed — no longer needed in profile-driven architecture
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { supportsReasoningEffortForModelId } from "../utils/providerUtils"
import type { ApiProfile } from "./ProviderProfile"
import { useProviderModels } from "./useProviderModels"

/**
 * Props for the OpenAINativeProvider component
 */
interface OpenAINativeProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	profile: ApiProfile
	onUpdate: (updates: Partial<ApiProfile>) => void
}

/**
 * The OpenAI (native) provider configuration component.
 * All data sourced from ApiProfile.
 */
export const OpenAINativeProvider = ({ showModelOptions, isPopup, profile, onUpdate }: OpenAINativeProviderProps) => {
	const {
		models: openAiNativeModels,
		defaultModelId: openAiNativeDefaultModelId,
		modelInfoSaneDefaults: openAiNativeModelInfoSaneDefaults,
	} = useProviderModels("openai-native")

	const modelId = profile.modelId || openAiNativeDefaultModelId
	const modelInfo =
		profile.modelInfo ??
		(profile.modelId ? openAiNativeModels[profile.modelId] : undefined) ??
		openAiNativeModelInfoSaneDefaults
	const showReasoningEffort = supportsReasoningEffortForModelId(modelId, true)

	return (
		<div>
			<ApiKeyField
				initialValue={profile.apiKey}
				onChange={(value) => onUpdate({ apiKey: value })}
				providerName="OpenAI"
				signupUrl="https://platform.openai.com/api-keys"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={openAiNativeModels}
						onChange={(e: any) => {
							const newModelId = e.target.value
							onUpdate({ modelId: newModelId, modelInfo: openAiNativeModels[newModelId] })
						}}
						selectedModelId={modelId}
					/>
					{showReasoningEffort && <ReasoningEffortSelector />}

					<ModelInfoView isPopup={isPopup} modelInfo={modelInfo} selectedModelId={modelId} />
				</>
			)}
		</div>
	)
}
