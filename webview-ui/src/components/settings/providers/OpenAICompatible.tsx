import type { ModelInfo } from "@shared/api"
import { OpenAiProviderConfig } from "@shared/proto/dline/provider/openai"
import { VSCodeButton, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useCallback } from "react"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelConfiguration } from "../common/ModelConfiguration"
import { ModelInfoView } from "../common/ModelInfoView"
import ThinkingControl from "../ThinkingControl"
import type { ApiProfile } from "./ProviderProfile"

/**
 * Props for the OpenAICompatibleProvider component
 */
interface OpenAICompatibleProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	profile: ApiProfile
	onUpdate: (updates: Partial<ApiProfile>) => void
}

/**
 * Helper: returns the openai provider config, falling back to a default
 * instance so all required fields are always present for spread operations.
 */
function getOpenAiConfig(profile: ApiProfile): OpenAiProviderConfig {
	return profile.openai ?? OpenAiProviderConfig.create({ streamIncludeUsage: true })
}

/**
 * The OpenAI Compatible provider configuration component.
 * Supports custom base URL, custom headers, Azure config, model configuration,
 * thinking/reasoning controls, and stream options.
 * All data sourced from ApiProfile.
 */
export const OpenAICompatibleProvider = ({ showModelOptions, isPopup, profile, onUpdate }: OpenAICompatibleProviderProps) => {
	const pc = getOpenAiConfig(profile)
	const modelId = profile.modelId || ""
	const modelInfo: ModelInfo | undefined = profile.modelInfo

	// --- Custom Headers management ---
	const openAiHeaders = pc.openAiHeaders ?? {}
	const headerEntries: [string, string][] = Object.entries(openAiHeaders)

	const addHeader = useCallback(() => {
		const current = { ...openAiHeaders }
		const headerCount = Object.keys(current).length
		const newKey = `header${headerCount + 1}`
		current[newKey] = ""
		onUpdate({ openai: { ...pc, openAiHeaders: current } })
	}, [profile, onUpdate, openAiHeaders, pc])

	const removeHeader = useCallback(
		(key: string) => {
			const { [key]: _, ...rest } = openAiHeaders
			onUpdate({ openai: { ...pc, openAiHeaders: rest } })
		},
		[profile, onUpdate, openAiHeaders, pc],
	)

	const updateHeader = useCallback(
		(oldKey: string, newKey: string, value: string) => {
			const { [oldKey]: _, ...rest } = openAiHeaders
			if (newKey) {
				rest[newKey] = value
			}
			onUpdate({ openai: { ...pc, openAiHeaders: rest } })
		},
		[profile, onUpdate, openAiHeaders, pc],
	)

	// Update ModelInfo directly (no longer update providerConfig.capabilities/pricing/temperature)
	const handleModelInfoUpdate = (updates: Partial<ModelInfo>) => {
		onUpdate({
			modelInfo: {
				...profile.modelInfo,
				...updates,
				id: modelId,
			},
		})
	}

	return (
		<div>
			{/* Base URL */}
			<BaseUrlField
				initialValue={profile.baseUrl}
				label="Use custom base URL"
				onChange={(value) => onUpdate({ baseUrl: value })}
				placeholder="Enter base URL..."
			/>

			{/* API Key */}
			<ApiKeyField
				initialValue={profile.apiKey}
				onChange={(v) => onUpdate({ apiKey: v })}
				providerName="OpenAI Compatible"
				signupUrl="https://platform.openai.com/api-keys"
			/>

			{/* Model ID — free text input since openai has no pre-defined model list */}
			<DebouncedTextField
				initialValue={modelId}
				onChange={(value) => onUpdate({ modelId: value })}
				placeholder={"Enter Model ID..."}
				style={{ width: "100%", marginBottom: 10 }}>
				<span style={{ fontWeight: 500 }}>Model ID</span>
			</DebouncedTextField>

			{/* ThinkingControl - placed after Model ID */}
			<ThinkingControl
				maxBudget={modelInfo?.capabilities?.thinking?.maxBudget}
				mode="both"
				modeSelectorLabel="Thinking Mode"
				modeSelectorOptions={[
					{ value: "effort", label: "Reasoning Effort" },
					{ value: "budget", label: "Thinking Budget" },
				]}
				onReasoningConfigUpdate={(reasoning) => {
					onUpdate({ openai: { ...pc, reasoning } })
				}}
				reasoningConfig={pc.reasoning}
				showModeSelector={true}
			/>

			{/* ModelConfiguration component */}
			<ModelConfiguration
				defaults={{}}
				fields={{
					capabilities: ["maxTokens", "contextWindow", "supportsImages", "supportsPromptCache"],
					pricing: ["inputPrice", "outputPrice", "cacheWritesPrice", "cacheReadsPrice"],
					other: ["temperature"],
				}}
				modelId={modelId}
				modelInfo={modelInfo!}
				onModelInfoUpdate={handleModelInfoUpdate}
			/>

			{/* Custom Headers */}
			<div style={{ marginBottom: 10 }}>
				<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
					<span style={{ fontWeight: 500 }}>Custom Headers</span>
					<VSCodeButton onClick={addHeader}>Add Header</VSCodeButton>
				</div>

				<div>
					{headerEntries.map(([key, value], index) => (
						<div key={`${key}-${index}`} style={{ display: "flex", gap: 5, marginTop: 5 }}>
							<DebouncedTextField
								initialValue={key}
								onChange={(newValue) => updateHeader(key, newValue, value)}
								placeholder="Header name"
								style={{ width: "40%" }}
							/>
							<DebouncedTextField
								initialValue={value}
								onChange={(newValue) => updateHeader(key, key, newValue)}
								placeholder="Header value"
								style={{ width: "40%" }}
							/>
							<VSCodeButton appearance="secondary" onClick={() => removeHeader(key)}>
								Remove
							</VSCodeButton>
						</div>
					))}
				</div>
			</div>

			{/* Azure API version */}
			<BaseUrlField
				initialValue={pc.azureApiVersion}
				label="Set Azure API version"
				onChange={(value) => onUpdate({ openai: { ...pc, azureApiVersion: value } })}
				placeholder={"Default: 2024-10-01-preview"}
			/>

			{/* Azure Identity Authentication */}
			<VSCodeCheckbox
				checked={pc.azureIdentity ?? false}
				onChange={(e: Event | React.FormEvent<HTMLElement>) => {
					const isChecked = (e.target as HTMLInputElement).checked === true
					onUpdate({ openai: { ...pc, azureIdentity: isChecked } })
				}}>
				Use Azure Identity Authentication
			</VSCodeCheckbox>

			{/* Include usage in stream */}
			<VSCodeCheckbox
				checked={pc.streamIncludeUsage ?? true}
				onChange={(e: Event | React.FormEvent<HTMLElement>) => {
					const isChecked = (e.target as HTMLInputElement).checked === true
					onUpdate({ openai: { ...pc, streamIncludeUsage: isChecked } })
				}}>
				Include usage stats in stream responses
			</VSCodeCheckbox>

			{/* Note about complex prompts */}
			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				<span style={{ color: "var(--vscode-errorForeground)" }}>
					(<span style={{ fontWeight: 500 }}>Note:</span> Dline uses complex prompts. Verify your model's capability
					before use.)
				</span>
			</p>

			{showModelOptions && modelInfo && <ModelInfoView isPopup={isPopup} modelInfo={modelInfo} selectedModelId={modelId} />}
		</div>
	)
}
