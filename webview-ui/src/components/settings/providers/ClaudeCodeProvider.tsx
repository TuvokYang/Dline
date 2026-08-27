import { ClaudeCodeProviderConfig } from "@shared/proto/dline/provider/claude_code"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"
import type { ApiProfile } from "./ProviderProfile"
import { useProviderModels } from "./useProviderModels"

const SUPPORTED_CLAUDE_CODE_THINKING_MODELS = [
	"claude-sonnet-4-6",
	"sonnet",
	"sonnet[1m]",
	"claude-opus-4-7[1m]",
	"claude-sonnet-4-6[1m]",
	"claude-sonnet-4-5-20250929[1m]",
	"claude-opus-4-6[1m]",
	"opus",
	"opus[1m]",
]

interface ClaudeCodeProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	profile: ApiProfile
	onUpdate: (updates: Partial<ApiProfile>) => void
}

/**
 * The Claude Code provider configuration component.
 * All data sourced from ApiProfile. claudeCodePath stored in providerConfig.
 */
export const ClaudeCodeProvider = ({ showModelOptions, isPopup, profile, onUpdate }: ClaudeCodeProviderProps) => {
	const {
		models: claudeCodeModels,
		defaultModelId: claudeCodeDefaultModelId,
		modelInfoSaneDefaults: claudeCodeModelInfoSaneDefaults,
	} = useProviderModels("claude-code")

	const pc = profile.claudeCode ?? ClaudeCodeProviderConfig.create()
	const modelId = profile.modelId || claudeCodeDefaultModelId
	const modelInfo =
		profile.modelInfo ?? (profile.modelId ? claudeCodeModels[profile.modelId] : undefined) ?? claudeCodeModelInfoSaneDefaults

	return (
		<div>
			<DebouncedTextField
				initialValue={pc.claudeCodePath ?? ""}
				onChange={(value) => onUpdate({ claudeCode: { ...pc, claudeCodePath: value } })}
				placeholder="Default: claude"
				style={{ width: "100%", marginTop: 3 }}
				type="text">
				<span style={{ fontWeight: 500 }}>Claude Code CLI Path</span>
			</DebouncedTextField>
			<p style={{ fontSize: "12px", marginTop: 3, color: "var(--vscode-descriptionForeground)" }}>
				Path to the Claude Code CLI.
			</p>
			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={claudeCodeModels}
						onChange={(e) => {
							const v = (e.target as HTMLSelectElement).value
							onUpdate({ modelId: v, modelInfo: claudeCodeModels[v] })
						}}
						selectedModelId={modelId}
					/>
					{(modelId === "sonnet" || modelId === "opus") && (
						<p
							style={{
								fontSize: "12px",
								marginBottom: 2,
								marginTop: 2,
								color: "var(--vscode-descriptionForeground)",
							}}>
							Use the latest version of {modelId} by default.
						</p>
					)}
					{SUPPORTED_CLAUDE_CODE_THINKING_MODELS.includes(modelId) && (
						<ThinkingBudgetSlider
							maxBudget={modelInfo?.capabilities?.thinking?.maxBudget}
							onThinkingBudgetTokensChange={(v) =>
								onUpdate({
									claudeCode: { ...pc, reasoning: { effort: pc.reasoning?.effort ?? "", thinkingBudget: v } },
								})
							}
							thinkingBudgetTokens={pc.reasoning?.thinkingBudget ?? 0}
						/>
					)}
					<ModelInfoView isPopup={isPopup} modelInfo={modelInfo} selectedModelId={modelId} />
				</>
			)}
		</div>
	)
}
