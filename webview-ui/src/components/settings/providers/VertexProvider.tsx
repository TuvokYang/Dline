import { VertexProviderConfig } from "@shared/proto/dline/provider/vertex"
import VertexData from "@shared/providers/vertex.json"
import { isClaudeOpusAdaptiveThinkingModel, resolveClaudeOpusAdaptiveThinking } from "@shared/utils/reasoning-support"
import { VSCodeDropdown, VSCodeLink, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { DROPDOWN_Z_INDEX, DropdownContainer } from "../ApiOptions"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import { LockIcon, RemotelyConfiguredInputWrapper } from "../common/RemotelyConfiguredInputWrapper"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import type { ApiProfile } from "./ProviderProfile"
import { useProviderModels } from "./useProviderModels"

const SUPPORTED_THINKING_MODELS = [
	"claude-sonnet-4-6",
	"claude-sonnet-4-6:1m",
	"claude-haiku-4-5@20251001",
	"claude-sonnet-4-5@20250929",
	"claude-3-7-sonnet@20250219",
	"claude-sonnet-4@20250514",
	"claude-opus-4@20250514",
	"claude-opus-4-1@20250805",
	"gemini-2.5-flash",
	"gemini-2.5-pro",
	"gemini-2.5-flash-lite-preview-06-17",
]

const REGIONS = VertexData.regions

interface VertexProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	profile: ApiProfile
	onUpdate: (updates: Partial<ApiProfile>) => void
}

/** GCP Vertex AI provider �?all data from ApiProfile. vertexProjectId/vertexRegion stored in providerConfig. */
export const VertexProvider = ({ showModelOptions, isPopup, profile, onUpdate }: VertexProviderProps) => {
	const { remoteConfigSettings } = useExtensionState()
	const remote = remoteConfigSettings as any
	const pc = profile.vertex ?? VertexProviderConfig.create()
	const vertexProjectId = pc.vertexProjectId ?? ""
	const vertexRegion = pc.vertexRegion ?? ""

	const { models, defaultModelId, modelInfoSaneDefaults } = useProviderModels("vertex")
	const modelId = profile.modelId || defaultModelId
	const modelInfo = profile.modelInfo ?? models[profile.modelId] ?? modelInfoSaneDefaults
	const reasoningEffort = pc.reasoning?.effort ?? ""
	const thinkingBudgetTokens = pc.reasoning?.thinkingBudget ? (pc.reasoning?.thinkingBudget ?? 0) : 0

	const isAdaptiveThinkingModel = isClaudeOpusAdaptiveThinkingModel(modelId)
	const adaptiveThinkingDefaultEffort =
		resolveClaudeOpusAdaptiveThinking(reasoningEffort, thinkingBudgetTokens).effort ?? "none"
	const persistConfig = (key: string, value: string) => onUpdate({ vertex: { ...pc, [key]: value } })

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
			<RemotelyConfiguredInputWrapper hidden={remote?.vertexProjectId === undefined}>
				<DebouncedTextField
					disabled={remote?.vertexProjectId !== undefined}
					initialValue={vertexProjectId}
					onChange={(value) => persistConfig("vertexProjectId", value)}
					placeholder="Enter Project ID..."
					style={{ width: "100%" }}>
					<div className="flex items-center gap-2 mb-1">
						<span style={{ fontWeight: 500 }}>Google Cloud Project ID</span>
						{remote?.vertexProjectId !== undefined && <LockIcon />}
					</div>
				</DebouncedTextField>
			</RemotelyConfiguredInputWrapper>
			<RemotelyConfiguredInputWrapper hidden={remote?.vertexRegion === undefined}>
				<DropdownContainer className="dropdown-container" zIndex={DROPDOWN_Z_INDEX - 1}>
					<div
						className="flex items-center gap-2 mb-1"
						style={{ opacity: remote?.vertexRegion !== undefined ? 0.4 : 1 }}>
						<label htmlFor="vertex-region-dropdown">
							<span className="font-medium">Google Cloud Region</span>
						</label>
						{remote?.vertexRegion !== undefined && <LockIcon />}
					</div>
					<VSCodeDropdown
						disabled={remote?.vertexRegion !== undefined}
						id="vertex-region-dropdown"
						onChange={(e: any) => persistConfig("vertexRegion", e.target.value)}
						style={{ width: "100%" }}
						value={vertexRegion}>
						<VSCodeOption value="">Select a region...</VSCodeOption>
						{REGIONS.map((r) => (
							<VSCodeOption key={r} value={r}>
								{r}
							</VSCodeOption>
						))}
					</VSCodeDropdown>
				</DropdownContainer>
			</RemotelyConfiguredInputWrapper>
			<p style={{ fontSize: "12px", marginTop: "5px", color: "var(--vscode-descriptionForeground)" }}>
				To use Google Cloud Vertex AI, you need to{" "}
				<VSCodeLink
					href="https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#before_you_begin"
					style={{ display: "inline", fontSize: "inherit" }}>
					{"1) create a Google Cloud account �?enable the Vertex AI API �?enable the desired Claude models,"}
				</VSCodeLink>{" "}
				<VSCodeLink
					href="https://cloud.google.com/docs/authentication/provide-credentials-adc#google-idp"
					style={{ display: "inline", fontSize: "inherit" }}>
					{"2) install the Google Cloud CLI �?configure Application Default Credentials."}
				</VSCodeLink>
			</p>
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
						zIndex={DROPDOWN_Z_INDEX - 2}
					/>
					{isAdaptiveThinkingModel ? (
						<ReasoningEffortSelector
							allowedEfforts={["none", "low", "medium", "high", "xhigh"] as const}
							defaultEffort={adaptiveThinkingDefaultEffort}
							description="Use None to disable adaptive thinking."
							label="Adaptive Thinking"
							onReasoningEffortChange={(v) =>
								onUpdate({
									vertex: {
										...pc,
										reasoning: { effort: v, thinkingBudget: pc.reasoning?.thinkingBudget ?? 0 },
									},
								})
							}
							reasoningEffort={reasoningEffort}
						/>
					) : SUPPORTED_THINKING_MODELS.includes(modelId) ? (
						<ThinkingBudgetSlider
							maxBudget={modelInfo.capabilities?.thinking?.maxBudget}
							onThinkingBudgetTokensChange={(v) =>
								onUpdate({
									vertex: { ...pc, reasoning: { effort: pc.reasoning?.effort ?? "", thinkingBudget: v } },
								})
							}
							thinkingBudgetTokens={thinkingBudgetTokens}
						/>
					) : null}
					{modelInfo.capabilities?.supportsReasoning && (
						<ReasoningEffortSelector
							onReasoningEffortChange={(v) =>
								onUpdate({
									vertex: {
										...pc,
										reasoning: { effort: v, thinkingBudget: pc.reasoning?.thinkingBudget ?? 0 },
									},
								})
							}
							reasoningEffort={pc.reasoning?.effort}
						/>
					)}
					<ModelInfoView isPopup={isPopup} modelInfo={modelInfo} selectedModelId={modelId} />
				</>
			)}
		</div>
	)
}
