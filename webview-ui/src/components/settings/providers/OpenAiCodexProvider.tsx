import { OpenAiCodexAuthStatus } from "@shared/proto/dline/account"
import { OpenAiCodexProviderConfig } from "@shared/proto/dline/provider/openai_codex"
import { buildEffectiveModelInfo } from "@shared/providers/effective-model-info"
import { OPENAI_REASONING_EFFORT_OPTIONS } from "@shared/storage/types"
import { useCallback, useEffect, useState } from "react"
import { AccountServiceClient } from "@/services/grpc-client"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import OpenAIServiceTierSelector from "../OpenAIServiceTierSelector"
import { ProfileActionRow, ProfileDisclosure, ProfileField, ProfileNotice, ProfileSection } from "../profile-ui"
import ThinkingControl from "../ThinkingControl"
import type { ApiProfile } from "./ProviderProfile"
import { useProviderModels } from "./useProviderModels"

interface OpenAiCodexProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	profile: ApiProfile
	onUpdate: (updates: Partial<ApiProfile>) => void
}

/**
 * Helper: returns the proto-generated openaiCodex provider config.
 *
 * The runtime provider id is "openai-codex", while the generated ApiProfile field
 * remains openaiCodex because proto field names cannot contain hyphens.
 */
function getCodexConfig(profile: ApiProfile): OpenAiCodexProviderConfig {
	return profile.openaiCodex ?? OpenAiCodexProviderConfig.create()
}

function isAuthenticated(status: OpenAiCodexAuthStatus): boolean {
	return (
		status === OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_AUTHENTICATED ||
		status === OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_REFRESHABLE_EXPIRED
	)
}

function statusPresentation(status: OpenAiCodexAuthStatus): { title: string; detail: string; warning: boolean } {
	switch (status) {
		case OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_AUTHENTICATED:
		case OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_REFRESHABLE_EXPIRED:
			return { title: "Signed in", detail: "This Profile has its own OpenAI OAuth credential.", warning: false }
		case OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_LEGACY_SHARED:
			return {
				title: "Profile sign-in required",
				detail: "Sign in to create a credential owned only by this Profile.",
				warning: true,
			}
		case OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_MALFORMED:
			return {
				title: "Stored credential is invalid",
				detail: "Sign in again to replace the invalid credential.",
				warning: true,
			}
		case OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_REAUTHENTICATION_REQUIRED:
			return { title: "Sign in again", detail: "The previous authorization grant is no longer valid.", warning: true }
		case OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_MISSING:
			return { title: "Not signed in", detail: "Use browser sign-in to connect this OpenAI Codex Profile.", warning: false }
		default:
			return { title: "Checking sign-in status", detail: "Reading the credential state for this Profile.", warning: false }
	}
}

function OpenAiCodexOAuthControl({ profileId }: { profileId: string }) {
	const [status, setStatus] = useState(OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_UNSPECIFIED)
	const [flowId, setFlowId] = useState<string>()
	const [callbackUri, setCallbackUri] = useState("")
	const [error, setError] = useState<string>()
	const [busy, setBusy] = useState(false)

	const refreshStatus = useCallback(async () => {
		try {
			const response = await AccountServiceClient.getOpenAiCodexAuthStatus({ profileId })
			if (response.profileId !== profileId) return
			setStatus(response.status)
			setFlowId(isAuthenticated(response.status) ? undefined : response.flowId || undefined)
		} catch {
			setError("Could not read OpenAI Codex sign-in status. Please try again.")
		}
	}, [profileId])

	useEffect(() => {
		setStatus(OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_UNSPECIFIED)
		setFlowId(undefined)
		setCallbackUri("")
		setError(undefined)
		void refreshStatus()
	}, [profileId, refreshStatus])

	useEffect(() => {
		const timer = setInterval(() => void refreshStatus(), flowId ? 1_000 : 5_000)
		return () => clearInterval(timer)
	}, [flowId, refreshStatus])

	const startSignIn = async () => {
		setBusy(true)
		setError(undefined)
		try {
			const flow = await AccountServiceClient.startOpenAiCodexSignIn({ profileId })
			if (flow.profileId === profileId) setFlowId(flow.flowId)
		} catch {
			setError("Could not start OpenAI Codex sign-in. Please try again.")
		} finally {
			setBusy(false)
		}
	}

	const completeSignIn = async () => {
		const submittedCallbackUri = callbackUri.trim()
		setCallbackUri("")
		if (!flowId || !submittedCallbackUri) {
			setError("Paste the full authorization callback URI before continuing.")
			return
		}
		setBusy(true)
		setError(undefined)
		try {
			const response = await AccountServiceClient.completeOpenAiCodexCallbackUri({
				profileId,
				flowId,
				callbackUri: submittedCallbackUri,
			})
			if (response.profileId === profileId) setStatus(response.status)
			if (isAuthenticated(response.status)) setFlowId(undefined)
		} catch {
			setError("Could not complete OpenAI Codex sign-in. Check the callback URI and try again.")
		} finally {
			setBusy(false)
		}
	}

	const cancelSignIn = async () => {
		if (!flowId) return
		setBusy(true)
		setError(undefined)
		try {
			await AccountServiceClient.cancelOpenAiCodexSignIn({ profileId, flowId })
			setFlowId(undefined)
			await refreshStatus()
		} catch {
			setError("Could not cancel OpenAI Codex sign-in. Please try again.")
		} finally {
			setBusy(false)
		}
	}

	const signOut = async () => {
		setBusy(true)
		setError(undefined)
		try {
			await AccountServiceClient.signOutOpenAiCodexProfile({ profileId })
			setFlowId(undefined)
			setStatus(OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_MISSING)
		} catch {
			setError("Could not sign out this OpenAI Codex Profile. Please try again.")
		} finally {
			setBusy(false)
		}
	}

	const presentation = statusPresentation(status)
	return (
		<ProfileSection aria-label="OpenAI Codex sign-in">
			<ProfileNotice
				title={flowId ? "Browser sign-in in progress" : presentation.title}
				variant={presentation.warning ? "warning" : "info"}>
				{flowId ? "Complete authorization in the browser, or use the callback URI fallback below." : presentation.detail}
			</ProfileNotice>
			{error ? <ProfileNotice variant="error">{error}</ProfileNotice> : null}
			<ProfileActionRow className="justify-start">
				{flowId ? (
					<button
						className="min-h-7 rounded-xs border border-button-border px-3 text-sm"
						disabled={busy}
						onClick={cancelSignIn}
						type="button">
						Cancel sign-in
					</button>
				) : (
					<button
						className="min-h-7 rounded-xs bg-button px-3 text-sm text-button-foreground"
						disabled={busy}
						onClick={startSignIn}
						type="button">
						{isAuthenticated(status) ? "Re-authenticate" : "Sign in with ChatGPT"}
					</button>
				)}
				{isAuthenticated(status) ? (
					<button
						className="min-h-7 rounded-xs border border-button-border px-3 text-sm"
						disabled={busy}
						onClick={signOut}
						type="button">
						Sign out
					</button>
				) : null}
			</ProfileActionRow>
			{flowId ? (
				<ProfileDisclosure title="Use callback URI fallback">
					<ProfileField
						description="Paste the complete localhost callback URI from the browser address bar. This value is never saved to the Profile."
						htmlFor={`openai-codex-callback-${profileId}`}
						label="Authorization callback URI">
						<input
							aria-label="Authorization callback URI"
							autoComplete="off"
							className="min-h-7 w-full rounded-xs border border-input-border bg-input-background px-2 text-sm"
							id={`openai-codex-callback-${profileId}`}
							onChange={(event) => setCallbackUri(event.target.value)}
							spellCheck={false}
							type="url"
							value={callbackUri}
						/>
					</ProfileField>
					<ProfileActionRow>
						<button
							className="min-h-7 rounded-xs bg-button px-3 text-sm text-button-foreground"
							disabled={busy}
							onClick={completeSignIn}
							type="button">
							Complete sign-in
						</button>
					</ProfileActionRow>
				</ProfileDisclosure>
			) : null}
		</ProfileSection>
	)
}

export const OpenAiCodexProvider = ({ showModelOptions, isPopup, profile, onUpdate }: OpenAiCodexProviderProps) => {
	const pc = getCodexConfig(profile)
	const { models, defaultModelId, modelInfoSaneDefaults } = useProviderModels("openai-codex")
	const modelId = profile.modelId || defaultModelId
	const registryModel = models[profile.modelId ?? ""] ?? modelInfoSaneDefaults
	const modelInfo = buildEffectiveModelInfo(modelId, registryModel, {
		capabilities: pc.capabilities,
		pricing: pc.pricing,
	})
	return (
		<div className="flex flex-col gap-4">
			<OpenAiCodexOAuthControl profileId={profile.id} />
			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={models}
						onChange={(e) => onUpdate({ modelId: (e.target as HTMLSelectElement).value })}
						selectedModelId={modelId}
					/>
					{/* Store reasoning under the existing proto-generated openaiCodex field. */}
					<ThinkingControl
						effortOptions={OPENAI_REASONING_EFFORT_OPTIONS}
						mode="both"
						modeSelectorLabel="Thinking Mode"
						modeSelectorOptions={[
							{ value: "effort", label: "Reasoning Effort" },
							{ value: "budget", label: "Thinking Budget" },
						]}
						onReasoningConfigUpdate={(reasoning) => {
							onUpdate({ openaiCodex: { ...pc, reasoning } })
						}}
						reasoningConfig={pc.reasoning}
						showModeSelector={true}
					/>
					<OpenAIServiceTierSelector
						onServiceTierChange={(serviceTier) => onUpdate({ openaiCodex: { ...pc, serviceTier } })}
						onServiceTierEnabledChange={(serviceTierEnabled) =>
							onUpdate({ openaiCodex: { ...pc, serviceTierEnabled } })
						}
						serviceTier={pc.serviceTier}
						serviceTierEnabled={pc.serviceTierEnabled !== false}
					/>
					<ModelInfoView isPopup={isPopup} modelInfo={modelInfo} selectedModelId={modelId} />
				</>
			)}
		</div>
	)
}
