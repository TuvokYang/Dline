import { BaseProviderConfig } from "@shared/proto/dline/provider/common"
import { buildEffectiveModelInfo } from "@shared/providers/effective-model-info"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
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
	const pc = profile.openaiNative ?? BaseProviderConfig.create()
	const registryModel = openAiNativeModels[modelId] ?? openAiNativeModelInfoSaneDefaults
	const modelInfo = buildEffectiveModelInfo(modelId, registryModel, {
		capabilities: pc.capabilities,
		pricing: pc.pricing,
		enableLongContext: pc.enableLongContext,
		pricingTiersEnabled: pc.pricingTiersEnabled,
	})
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
						onChange={(e) => onUpdate({ modelId: (e.target as HTMLSelectElement).value })}
						selectedModelId={modelId}
					/>
					{modelInfo.capabilities?.contextWindowTiers?.length ? (
						<VSCodeCheckbox
							checked={pc.enableLongContext === true}
							onChange={(event: Event | React.FormEvent<HTMLElement>) =>
								onUpdate({
									openaiNative: {
										...pc,
										enableLongContext: (event.target as HTMLInputElement | null)?.checked === true,
									},
								})
							}>
							Enable Long Context
						</VSCodeCheckbox>
					) : null}
					{showReasoningEffort && <ReasoningEffortSelector />}

					<ModelInfoView isPopup={isPopup} modelInfo={modelInfo} selectedModelId={modelId} />
				</>
			)}
		</div>
	)
}
