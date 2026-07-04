// Mode import removed — no longer needed in profile-driven architecture
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import type { ApiProfile } from "./ProviderProfile"
import { useProviderModels } from "./useProviderModels"

interface NebiusProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	profile: ApiProfile
	onUpdate: (updates: Partial<ApiProfile>) => void
}

/** Nebius AI Studio provider �?all data from ApiProfile. */
export const NebiusProvider = ({ showModelOptions, isPopup, profile, onUpdate }: NebiusProviderProps) => {
	const { models, defaultModelId, modelInfoSaneDefaults } = useProviderModels("nebius")
	const modelId = profile.modelId || defaultModelId
	const modelInfo = profile.modelInfo ?? models[profile.modelId] ?? modelInfoSaneDefaults
	return (
		<div>
			<ApiKeyField
				initialValue={profile.apiKey}
				onChange={(v) => onUpdate({ apiKey: v })}
				providerName="Nebius"
				signupUrl="https://studio.nebius.com/"
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
