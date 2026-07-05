import type { ModelInfo } from "@shared/api"
import { ModelCapabilities } from "@shared/proto/dline/models/metadata"
import { OpenAiProviderConfig } from "@shared/proto/dline/provider/openai"
import { VSCodeButton, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useState } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import { parsePrice } from "../utils/pricingUtils"
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

type ThinkingMode = "effort" | "budget"

/**
 * Infer current thinking mode from ReasoningConfig.
 */
function inferThinkingMode(pc: OpenAiProviderConfig): ThinkingMode {
	if (pc.reasoning?.thinkingBudget != null && pc.reasoning.thinkingBudget > 0) {
		return "budget"
	}
	return "effort"
}

/**
 * The OpenAI Compatible provider configuration component.
 * Supports custom base URL, custom headers, Azure config, model configuration,
 * thinking/reasoning controls, and stream options.
 * All data sourced from ApiProfile.
 */
export const OpenAICompatibleProvider = ({ showModelOptions, isPopup, profile, onUpdate }: OpenAICompatibleProviderProps) => {
	const [modelConfigurationSelected, setModelConfigurationSelected] = useState(false)

	const pc = getOpenAiConfig(profile)
	const modelId = profile.modelId || ""
	const modelInfo: ModelInfo | undefined = profile.modelInfo
	const thinkingMode = inferThinkingMode(pc)

	/** Currency symbol lookup — used in price labels. */
	const currSymbol = ((): string => {
		const c = modelInfo?.pricing?.currency || "USD"
		const map: Record<string, string> = { USD: "$", CNY: "¥", EUR: "€", GBP: "£" }
		return map[c] || "$"
	})()

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

			{/* Thinking / Reasoning Controls */}
			<div style={{ marginTop: 10 }}>
				<Label className="text-xs font-medium">Thinking Mode</Label>
				<Select
					onValueChange={(value: ThinkingMode) => {
						if (value === "effort") {
							onUpdate({
								openai: {
									...pc,
									reasoning: { effort: pc.reasoning?.effort ?? "medium", thinkingBudget: 0 },
								},
							})
						} else {
							onUpdate({
								openai: {
									...pc,
									reasoning: { effort: "", thinkingBudget: pc.reasoning?.thinkingBudget || 16000 },
								},
							})
						}
					}}
					value={thinkingMode}>
					<SelectTrigger className="w-full mt-1">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="effort">Reasoning Effort</SelectItem>
						<SelectItem value="budget">Thinking Budget</SelectItem>
					</SelectContent>
				</Select>
			</div>

			{thinkingMode === "effort" && (
				<ReasoningEffortSelector
					onReasoningEffortChange={(v) =>
						onUpdate({
							openai: { ...pc, reasoning: { effort: v, thinkingBudget: 0 } },
						})
					}
					reasoningEffort={pc.reasoning?.effort}
				/>
			)}

			{thinkingMode === "budget" && (
				<ThinkingBudgetSlider
					maxBudget={modelInfo?.capabilities?.thinking?.maxBudget}
					onThinkingBudgetTokensChange={(v) =>
						onUpdate({
							openai: { ...pc, reasoning: { effort: "", thinkingBudget: v } },
						})
					}
					thinkingBudgetTokens={pc.reasoning?.thinkingBudget ?? 0}
				/>
			)}

			{/* Include usage in stream */}
			<VSCodeCheckbox
				checked={pc.streamIncludeUsage ?? true}
				onChange={(e: Event | React.FormEvent<HTMLElement>) => {
					const isChecked = (e.target as HTMLInputElement).checked === true
					onUpdate({ openai: { ...pc, streamIncludeUsage: isChecked } })
				}}>
				Include usage stats in stream responses
			</VSCodeCheckbox>

			{/* Model Configuration Collapsible */}
			<div
				onClick={() => setModelConfigurationSelected((val) => !val)}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault()
						setModelConfigurationSelected((val) => !val)
					}
				}}
				role="button"
				style={{
					color: "var(--vscode-descriptionForeground)",
					display: "flex",
					margin: "10px 0",
					cursor: "pointer",
					alignItems: "center",
				}}
				tabIndex={0}>
				<span
					className={`codicon ${modelConfigurationSelected ? "codicon-chevron-down" : "codicon-chevron-right"}`}
					style={{ marginRight: "4px" }}
				/>
				<span style={{ fontWeight: 700, textTransform: "uppercase" }}>Model Configuration</span>
			</div>

			{modelConfigurationSelected && (
				<>
					{/* Supports Images */}
					<VSCodeCheckbox
						checked={!!modelInfo?.capabilities?.supportsImages}
						onChange={(e: Event | React.FormEvent<HTMLElement>) => {
							const isChecked = (e.target as HTMLInputElement).checked === true
							onUpdate({
								modelInfo: {
									...modelInfo,
									id: modelInfo?.id || modelId,
									capabilities: {
										...(modelInfo?.capabilities ?? ModelCapabilities.fromPartial({})),
										supportsImages: isChecked,
									},
								},
							})
						}}>
						Supports Images
					</VSCodeCheckbox>

					{/* Supports Prompt Cache */}
					<VSCodeCheckbox
						checked={!!modelInfo?.capabilities?.supportsPromptCache}
						onChange={(e: Event | React.FormEvent<HTMLElement>) => {
							const isChecked = (e.target as HTMLInputElement).checked === true
							onUpdate({
								modelInfo: {
									...modelInfo,
									id: modelInfo?.id || modelId,
									capabilities: {
										...(modelInfo?.capabilities ?? ModelCapabilities.fromPartial({})),
										supportsPromptCache: isChecked,
									},
								},
							})
						}}>
						Supports Prompt Cache
					</VSCodeCheckbox>

					{/* Currency */}
					<div style={{ marginTop: 5, marginBottom: 5 }}>
						<Label className="text-xs font-medium">Currency</Label>
						<Select
							onValueChange={(value: string) =>
								onUpdate({
									modelInfo: {
										...modelInfo,
										id: modelInfo?.id || modelId,
										pricing: {
											...modelInfo?.pricing,
											currency: value,
										},
									},
								})
							}
							value={modelInfo?.pricing?.currency || "USD"}>
							<SelectTrigger className="w-full mt-1">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="USD">USD ($)</SelectItem>
								<SelectItem value="CNY">CNY (¥)</SelectItem>
								<SelectItem value="EUR">EUR (€)</SelectItem>
								<SelectItem value="GBP">GBP (£)</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{/* Context Window Size & Max Output Tokens */}
					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={
								modelInfo?.capabilities?.contextWindow ? String(modelInfo.capabilities.contextWindow) : ""
							}
							onChange={(value) =>
								onUpdate({
									modelInfo: {
										...modelInfo,
										id: modelInfo?.id || modelId,
										capabilities: {
											...(modelInfo?.capabilities ?? ModelCapabilities.fromPartial({})),
											contextWindow: Number(value),
										},
									},
								})
							}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Context Window Size</span>
						</DebouncedTextField>

						<DebouncedTextField
							initialValue={modelInfo?.capabilities?.maxTokens ? String(modelInfo.capabilities.maxTokens) : ""}
							onChange={(value) =>
								onUpdate({
									modelInfo: {
										...modelInfo,
										id: modelInfo?.id || modelId,
										capabilities: {
											...(modelInfo?.capabilities ?? ModelCapabilities.fromPartial({})),
											maxTokens: Number(value),
										},
									},
								})
							}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Max Output Tokens</span>
						</DebouncedTextField>
					</div>

					{/* Input Price & Output Price */}
					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={modelInfo?.pricing?.inputPrice != null ? String(modelInfo.pricing.inputPrice) : ""}
							onChange={(value) =>
								onUpdate({
									modelInfo: {
										...modelInfo,
										id: modelInfo?.id || modelId,
										pricing: {
											...modelInfo?.pricing,
											inputPrice: parsePrice(value, 0),
										},
									},
								})
							}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Input Price ({currSymbol}/1M tokens)</span>
						</DebouncedTextField>

						<DebouncedTextField
							initialValue={modelInfo?.pricing?.outputPrice != null ? String(modelInfo.pricing.outputPrice) : ""}
							onChange={(value) =>
								onUpdate({
									modelInfo: {
										...modelInfo,
										id: modelInfo?.id || modelId,
										pricing: {
											...modelInfo?.pricing,
											outputPrice: parsePrice(value, 0),
										},
									},
								})
							}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Output Price ({currSymbol}/1M tokens)</span>
						</DebouncedTextField>
					</div>

					{/* Cache Writes Price & Cache Reads Price */}
					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={
								modelInfo?.pricing?.cacheWritesPrice != null ? String(modelInfo.pricing.cacheWritesPrice) : ""
							}
							onChange={(value) =>
								onUpdate({
									modelInfo: {
										...modelInfo,
										id: modelInfo?.id || modelId,
										pricing: {
											...modelInfo?.pricing,
											cacheWritesPrice: parsePrice(value, 0),
										},
									},
								})
							}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Cache Writes ({currSymbol}/M)</span>
						</DebouncedTextField>

						<DebouncedTextField
							initialValue={
								modelInfo?.pricing?.cacheReadsPrice != null ? String(modelInfo.pricing.cacheReadsPrice) : ""
							}
							onChange={(value) =>
								onUpdate({
									modelInfo: {
										...modelInfo,
										id: modelInfo?.id || modelId,
										pricing: {
											...modelInfo?.pricing,
											cacheReadsPrice: parsePrice(value, 0),
										},
									},
								})
							}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Cache Reads ({currSymbol}/M)</span>
						</DebouncedTextField>
					</div>

					{/* Temperature — stored in OpenAiProviderConfig, not modelInfo */}
					<DebouncedTextField
						initialValue={pc.temperature != null ? String(pc.temperature) : ""}
						onChange={(value) =>
							onUpdate({
								openai: { ...pc, temperature: parsePrice(value, 0) },
							})
						}
						style={{ marginTop: "5px" }}>
						<span style={{ fontWeight: 500 }}>Temperature</span>
					</DebouncedTextField>
				</>
			)}

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
