// Mode import removed — no longer needed in profile-driven architecture
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import type { ApiProfile } from "./ProviderProfile"
import { useProviderModels } from "./useProviderModels"

interface DoubaoProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	profile: ApiProfile
	onUpdate: (updates: Partial<ApiProfile>) => void
}

/** ByteDance Doubao provider �?all data from ApiProfile. */
export const DoubaoProvider = ({ showModelOptions, isPopup, profile, onUpdate }: DoubaoProviderProps) => {
	const { models, defaultModelId, modelInfoSaneDefaults } = useProviderModels("doubao")
	const modelId = profile.modelId || defaultModelId
	const modelInfo = profile.modelInfo ?? models[profile.modelId] ?? modelInfoSaneDefaults
	return (
		<div>
			<ApiKeyField
				initialValue={profile.apiKey}
				onChange={(v) => onUpdate({ apiKey: v })}
				providerName="Doubao"
				signupUrl="https://console.volcengine.com/home"
			/>
			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={models}
						onChange={(e) =>
							onUpdate({
								modelId: (e.target as HTMLSelectElement).value,
								modelInfo: models[(e.target as HTMLSelectElement).value],
							})
						}
						selectedModelId={modelId}
					/>
					<ModelInfoView isPopup={isPopup} modelInfo={modelInfo} selectedModelId={modelId} />
				</>
			)}
		</div>
	)
}
