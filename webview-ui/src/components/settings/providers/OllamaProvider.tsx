import { StringRequest } from "@shared/proto/dline/common"
import { OllamaProviderConfig } from "@shared/proto/dline/provider/ollama"
// Mode import removed — no longer needed in profile-driven architecture
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useState } from "react"
import { useInterval } from "react-use"
import UseCustomPromptCheckbox from "@/components/settings/UseCustomPromptCheckbox"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import OllamaModelPicker from "../OllamaModelPicker"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import type { ApiProfile } from "./ProviderProfile"

interface OllamaProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	profile: ApiProfile
	onUpdate: (updates: Partial<ApiProfile>) => void
}

/** Ollama provider �?all data from ApiProfile. requestTimeoutMs from apiConfiguration (one of 6 remaining fields). */
export const OllamaProvider = ({ showModelOptions, isPopup: _isPopup, profile, onUpdate }: OllamaProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()
	const pc = profile.ollama ?? OllamaProviderConfig.create()

	const [ollamaModels, setOllamaModels] = useState<string[]>([])
	const baseUrl = profile.baseUrl || ""

	const requestOllamaModels = useCallback(async () => {
		try {
			const response = await ModelsServiceClient.getOllamaModels(StringRequest.create({ value: baseUrl }))
			if (response?.values) setOllamaModels(response.values)
		} catch {
			setOllamaModels([])
		}
	}, [baseUrl])

	useEffect(() => {
		requestOllamaModels()
	}, [requestOllamaModels])
	useInterval(requestOllamaModels, 2000)

	return (
		<div className="flex flex-col gap-2">
			<BaseUrlField
				initialValue={profile.baseUrl}
				label="Use custom base URL"
				onChange={(value) => onUpdate({ baseUrl: value || undefined })}
				placeholder="Default: http://localhost:11434"
			/>
			{profile.baseUrl && (
				<ApiKeyField
					helpText="Optional API key for authenticated Ollama instances."
					initialValue={profile.apiKey}
					onChange={(value) => onUpdate({ apiKey: value })}
					placeholder="Enter API Key (optional)..."
					providerName="Ollama"
				/>
			)}
			<label htmlFor="ollama-model-selection">
				<span className="font-semibold">Model</span>
			</label>
			<OllamaModelPicker
				ollamaModels={ollamaModels}
				onModelChange={(modelId) => onUpdate({ modelId })}
				placeholder={ollamaModels.length > 0 ? "Search and select a model..." : "e.g. llama3.1"}
				selectedModelId={profile.modelId || ""}
			/>
			{ollamaModels.length === 0 && (
				<p className="text-sm mt-1 text-description italic">
					Unable to fetch models from Ollama server. Please ensure Ollama is running and accessible.
				</p>
			)}
			<DebouncedTextField
				initialValue={pc.ollamaApiOptionsCtxNum || "32768"}
				onChange={(v) => onUpdate({ ollama: { ...pc, ollamaApiOptionsCtxNum: v ?? undefined } })}
				placeholder="e.g. 32768"
				style={{ width: "100%" }}>
				<span className="font-semibold">Model Context Window</span>
			</DebouncedTextField>
			{showModelOptions && (
				<>
					<DebouncedTextField
						initialValue={apiConfiguration?.requestTimeoutMs ? String(apiConfiguration.requestTimeoutMs) : "30000"}
						onChange={(value) => {
							const n = Number.parseInt(value, 10)
							if (!Number.isNaN(n) && n > 0) handleFieldChange("requestTimeoutMs", n)
						}}
						placeholder="Default: 30000 (30 seconds)"
						style={{ width: "100%" }}>
						<span className="font-semibold">Request Timeout (ms)</span>
					</DebouncedTextField>
					<p className="text-xs mt-0 text-description">
						Maximum time in milliseconds to wait for API responses before timing out.
					</p>
				</>
			)}
			<UseCustomPromptCheckbox providerId="ollama" />
			<p style={{ fontSize: "12px", marginTop: "5px", color: "var(--vscode-descriptionForeground)" }}>
				Ollama allows you to run models locally on your computer. See their{" "}
				<VSCodeLink
					href="https://github.com/ollama/ollama/blob/main/README.md"
					style={{ display: "inline", fontSize: "inherit" }}>
					quickstart guide.
				</VSCodeLink>{" "}
				<span style={{ color: "var(--vscode-errorForeground)" }}>
					(<span style={{ fontWeight: 500 }}>Note:</span> Dline uses complex prompts. Verify your model's capability
					before use.)
				</span>
			</p>
		</div>
	)
}
