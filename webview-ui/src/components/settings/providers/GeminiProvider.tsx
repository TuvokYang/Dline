// Mode import removed — no longer needed in profile-driven architecture
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { supportsReasoningEffortForModelId } from "../utils/providerUtils"
import type { ApiProfile } from "./ProviderProfile"
import { useProviderModels } from "./useProviderModels"

/**
 * Props for the GeminiProvider component
 */
interface GeminiProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	profile: ApiProfile
	onUpdate: (updates: Partial<ApiProfile>) => void
}

/**
 * The Gemini provider configuration component.
 * All data sourced from ApiProfile.
 */
export const GeminiProvider = ({ showModelOptions, isPopup, profile, onUpdate }: GeminiProviderProps) => {
	const {
		models: geminiModels,
		defaultModelId: geminiDefaultModelId,
		modelInfoSaneDefaults: geminiModelInfoSaneDefaults,
	} = useProviderModels("gemini")

	const modelId = profile.modelId || geminiDefaultModelId
	const modelInfo =
		profile.modelInfo ?? (profile.modelId ? geminiModels[profile.modelId] : undefined) ?? geminiModelInfoSaneDefaults
	const showReasoningEffort = supportsReasoningEffortForModelId(modelId)

	return (
		<div>
			<ApiKeyField
				initialValue={profile.apiKey}
				onChange={(value) => onUpdate({ apiKey: value })}
				providerName="Gemini"
				signupUrl="https://aistudio.google.com/apikey"
			/>

			<BaseUrlField
				initialValue={profile.baseUrl}
				label="Use custom base URL"
				onChange={(value) => onUpdate({ baseUrl: value || undefined })}
				placeholder="Default: https://generativelanguage.googleapis.com"
			/>

			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={geminiModels}
						onChange={(e) =>
							onUpdate({
								modelId: (e.target as HTMLSelectElement).value,
								modelInfo: geminiModels[(e.target as HTMLSelectElement).value],
							})
						}
						selectedModelId={modelId}
					/>

					{showReasoningEffort && <ReasoningEffortSelector />}

					<ModelInfoView isPopup={isPopup} modelInfo={modelInfo} selectedModelId={modelId} />
				</>
			)}
		</div>
	)
}
