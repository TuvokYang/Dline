import { type ModelInfo, openAiModelInfoSaneDefaults } from "@shared/api"
import { OpenAiModelsRequest } from "@shared/proto/dline/models"
import { ApiFormat, type ModelCapabilities, type ModelPricing, ServerTool } from "@shared/proto/dline/models/metadata"
import { OpenAiPromptCacheMode, OpenAiProviderConfig } from "@shared/proto/dline/provider/openai"
import { openAiEndpointToApiFormat, resolveApiFormat } from "@shared/providers/api-format"
import { buildEffectiveModelInfo, mergeCapabilities, mergePricing } from "@shared/providers/effective-model-info"
import { DEFAULT_OPENAI_RESPONSES_STREAM_IDLE_TIMEOUT_SECONDS } from "@shared/providers/openai-stream"
import { OPENAI_COMPATIBLE_REASONING_EFFORT_OPTIONS, OPENAI_REASONING_EFFORT_OPTIONS } from "@shared/storage/types"
import { VSCodeButton, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useId, useMemo, useState } from "react"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiFormatSelector } from "../common/ApiFormatSelector"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelAutocomplete } from "../common/ModelAutocomplete"
import { ModelConfiguration } from "../common/ModelConfiguration"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import OpenAIServiceTierSelector from "../OpenAIServiceTierSelector"
import ThinkingControl from "../ThinkingControl"
import { ProfileActionRow, ProfileField, ProfileNotice, ProfileSection, ProfileSectionTitle } from "../profile-ui"
import { getModelCompatibilityNotice } from "./modelCompatibilityNotice"
import type { ApiProfile } from "./ProviderProfile"
import { ProviderWebSearchSettings } from "./ProviderWebSearchSettings"
import { useProviderModels } from "./useProviderModels"

interface OpenAIProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	profile: ApiProfile
	onUpdate: (updates: Partial<ApiProfile>) => void
}

const CUSTOM_OPENAI_API_FORMATS = [ApiFormat.OPENAI_CHAT, ApiFormat.OPENAI_RESPONSES]

function getOpenAiConfig(profile: ApiProfile): OpenAiProviderConfig {
	return profile.openai ?? OpenAiProviderConfig.create({ streamIncludeUsage: true })
}

/** Unified OpenAI API-key provider for official and custom OpenAI-compatible models. */
export const OpenAIProvider = ({ showModelOptions, isPopup, profile, onUpdate }: OpenAIProviderProps) => {
	const pc = getOpenAiConfig(profile)
	const fieldId = useId()
	const streamIdleTimeoutId = `${fieldId}-stream-idle-timeout`
	const { models, defaultModelId, modelInfoSaneDefaults } = useProviderModels("openai")
	const [discoveredModelIds, setDiscoveredModelIds] = useState<string[]>([])
	// Profiles created by the former OpenAI Compatible provider have no
	// customModelEnabled flag. Preserve their free-form model ID after the
	// provider consolidation instead of forcing an unknown ID into the
	// official model selector.
	const customModelEnabled = pc.customModelEnabled === true || (!!profile.modelId && models[profile.modelId] === undefined)
	const modelId = profile.modelId || (customModelEnabled ? "" : defaultModelId)
	const registryModel = customModelEnabled ? undefined : models[modelId]
	const baseModel = customModelEnabled
		? (profile.modelInfo ?? openAiModelInfoSaneDefaults)
		: (registryModel ?? profile.modelInfo ?? modelInfoSaneDefaults)
	const modelInfo: ModelInfo = buildEffectiveModelInfo(modelId, baseModel, {
		capabilities: pc.capabilities,
		pricing: pc.pricing,
		enableLongContext: pc.enableLongContext,
		pricingTiersEnabled: pc.pricingTiersEnabled,
	})
	const compatibilityCapabilities = customModelEnabled
		? mergeCapabilities(profile.modelInfo?.capabilities, pc.capabilities ?? {})
		: modelInfo.capabilities
	const compatibilityNotice = getModelCompatibilityNotice({
		capabilities: compatibilityCapabilities,
		requireCompleteMetadata: customModelEnabled,
	})
	const apiFormats =
		registryModel?.apiFormats ??
		(customModelEnabled ? profile.modelInfo?.apiFormats : undefined) ??
		(customModelEnabled ? openAiModelInfoSaneDefaults.apiFormats : modelInfoSaneDefaults.apiFormats) ??
		CUSTOM_OPENAI_API_FORMATS
	const selectedApiFormat = resolveApiFormat(
		pc.apiFormat ?? openAiEndpointToApiFormat(pc.apiEndpoint),
		{ apiFormats },
		ApiFormat.OPENAI_CHAT,
	)
	const hostedWebSearchAvailable =
		modelInfo.capabilities?.tools?.includes(ServerTool.WEB_SEARCH) === true &&
		(selectedApiFormat === ApiFormat.OPENAI_RESPONSES || selectedApiFormat === ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE)
	const customModels = useMemo<Record<string, ModelInfo>>(() => {
		const modelIds = new Set(discoveredModelIds)
		if (modelId) modelIds.add(modelId)
		return Object.fromEntries(
			Array.from(modelIds).map((id) => [id, { ...openAiModelInfoSaneDefaults, id, name: id, userDefined: true }]),
		)
	}, [discoveredModelIds, modelId])
	const refreshCustomModels = useCallback(async () => {
		if (!profile.baseUrl || !profile.apiKey) return
		try {
			const response = await ModelsServiceClient.refreshOpenAiModels(
				OpenAiModelsRequest.create({ baseUrl: profile.baseUrl, apiKey: profile.apiKey }),
			)
			setDiscoveredModelIds([...new Set(response.values.filter(Boolean))])
		} catch (error) {
			console.error("Failed to refresh OpenAI models", error)
		}
	}, [profile.apiKey, profile.baseUrl])

	const openAiHeaders = pc.openAiHeaders ?? {}
	const headerEntries: [string, string][] = Object.entries(openAiHeaders)

	const addHeader = useCallback(() => {
		const current = { ...openAiHeaders }
		current[`header${Object.keys(current).length + 1}`] = ""
		onUpdate({ openai: { ...pc, openAiHeaders: current } })
	}, [onUpdate, openAiHeaders, pc])

	const removeHeader = useCallback(
		(key: string) => {
			const { [key]: _, ...rest } = openAiHeaders
			onUpdate({ openai: { ...pc, openAiHeaders: rest } })
		},
		[onUpdate, openAiHeaders, pc],
	)

	const updateHeader = useCallback(
		(oldKey: string, newKey: string, value: string) => {
			const { [oldKey]: _, ...rest } = openAiHeaders
			if (newKey) rest[newKey] = value
			onUpdate({ openai: { ...pc, openAiHeaders: rest } })
		},
		[onUpdate, openAiHeaders, pc],
	)

	const handleCapabilitiesUpdate = (updates: Partial<ModelCapabilities>) => {
		onUpdate({ openai: { ...pc, capabilities: mergeCapabilities(pc.capabilities, updates) } })
	}

	const handlePricingUpdate = (updates: Partial<ModelPricing>) => {
		onUpdate({
			openai: {
				...pc,
				pricing: mergePricing(pc.pricing, updates),
				...(updates.tiers === undefined ? {} : { pricingTiersEnabled: true }),
			},
		})
	}

	const handleStreamIdleTimeoutChange = (value: string) => {
		const seconds = Number.parseInt(value, 10)
		if (!Number.isSafeInteger(seconds) || seconds <= 0) return
		onUpdate({ openai: { ...pc, streamIdleTimeoutSeconds: seconds } })
	}

	const handleCustomModelToggle = (checked: boolean) => {
		const nextModelId = checked
			? models[modelId]
				? "custom-model"
				: modelId || "custom-model"
			: defaultModelId || Object.keys(models)[0] || modelId
		const nextFormats = checked
			? CUSTOM_OPENAI_API_FORMATS
			: (models[nextModelId]?.apiFormats ?? modelInfoSaneDefaults.apiFormats ?? CUSTOM_OPENAI_API_FORMATS)
		onUpdate({
			modelId: nextModelId,
			openai: {
				...pc,
				apiEndpoint: undefined,
				apiFormat: resolveApiFormat(selectedApiFormat, { apiFormats: nextFormats }, ApiFormat.OPENAI_CHAT),
				customModelEnabled: checked,
			},
		})
	}

	const handleOfficialModelChange = (nextModelId: string) => {
		const nextModel = models[nextModelId]
		onUpdate({
			modelId: nextModelId,
			openai: {
				...pc,
				apiEndpoint: undefined,
				apiFormat: resolveApiFormat(selectedApiFormat, nextModel, ApiFormat.OPENAI_CHAT),
			},
		})
	}

	return (
		<div className="flex min-w-0 flex-col gap-3">
			<BaseUrlField
				initialValue={profile.baseUrl}
				label="Use custom base URL"
				onChange={(value) => onUpdate({ baseUrl: value || undefined })}
				placeholder="Enter base URL..."
			/>

			<ApiKeyField
				initialValue={profile.apiKey}
				onChange={(value) => onUpdate({ apiKey: value })}
				providerName="OpenAI"
				signupUrl="https://platform.openai.com/api-keys"
			/>

			{showModelOptions && (
				<>
					<VSCodeCheckbox
						checked={customModelEnabled}
						onChange={(event: Event | React.FormEvent<HTMLElement>) =>
							handleCustomModelToggle((event.target as HTMLInputElement | null)?.checked === true)
						}>
						Use custom model ID
					</VSCodeCheckbox>

					{customModelEnabled ? (
						<ModelAutocomplete
							label="Model ID"
							models={customModels}
							onChange={(value) => onUpdate({ modelId: value })}
							onOpen={() => void refreshCustomModels()}
							placeholder="Enter Model ID..."
							selectedModelId={modelId}
						/>
					) : (
						<>
							<ModelSelector
								label="Model"
								models={models}
								onChange={(event) => handleOfficialModelChange((event.target as HTMLSelectElement).value)}
								selectedModelId={modelId}
							/>
						</>
					)}

					<ApiFormatSelector
						apiFormats={apiFormats}
						fallbackApiFormat={ApiFormat.OPENAI_CHAT}
						onChange={(apiFormat) => onUpdate({ openai: { ...pc, apiEndpoint: undefined, apiFormat } })}
						selectedApiFormat={selectedApiFormat}
					/>

					<VSCodeCheckbox
						checked={pc.promptCacheMode === OpenAiPromptCacheMode.OPENAI_PROMPT_CACHE_MODE_EXPLICIT}
						onChange={(event: Event | React.FormEvent<HTMLElement>) =>
							onUpdate({
								openai: {
									...pc,
									promptCacheMode: (event.target as HTMLInputElement | null)?.checked
										? OpenAiPromptCacheMode.OPENAI_PROMPT_CACHE_MODE_EXPLICIT
										: OpenAiPromptCacheMode.OPENAI_PROMPT_CACHE_MODE_AUTOMATIC,
								},
							})
						}>
						Use explicit prompt cache controls
					</VSCodeCheckbox>
					<p style={{ fontSize: 12, marginTop: 0, color: "var(--vscode-descriptionForeground)" }}>
						Enable only when the selected endpoint supports prompt_cache_breakpoint. Rejected controls fall back to
						automatic caching for the current task.
					</p>

					<ProviderWebSearchSettings
						hostedAvailable={hostedWebSearchAvailable}
						onChange={(webSearchMode) => onUpdate({ webSearchMode })}
						value={profile.webSearchMode}
					/>

					<ThinkingControl
						effortOptions={
							customModelEnabled ? OPENAI_COMPATIBLE_REASONING_EFFORT_OPTIONS : OPENAI_REASONING_EFFORT_OPTIONS
						}
						maxBudget={modelInfo.capabilities?.thinking?.maxBudget}
						mode="both"
						modeSelectorLabel="Thinking Mode"
						modeSelectorOptions={[
							{ value: "effort", label: "Reasoning Effort" },
							{ value: "budget", label: "Thinking Budget" },
						]}
						onReasoningConfigUpdate={(reasoning) => onUpdate({ openai: { ...pc, reasoning } })}
						reasoningConfig={pc.reasoning}
						showModeSelector={true}
					/>

					<OpenAIServiceTierSelector
						onServiceTierChange={(serviceTier) => onUpdate({ openai: { ...pc, serviceTier } })}
						onServiceTierEnabledChange={(serviceTierEnabled) => onUpdate({ openai: { ...pc, serviceTierEnabled } })}
						serviceTier={pc.serviceTier}
						serviceTierEnabled={pc.serviceTierEnabled}
					/>

					<ModelConfiguration
						capabilities={pc.capabilities}
						defaults={baseModel}
						fields={{
							// OpenAI models are controlled directly by context size; they have no
							// context-window tiers. Pricing tiers are usage-based tiered pricing.
							capabilities: [
								"maxTokens",
								"contextWindow",
								"supportsImages",
								"supportsWebSearch",
								...(customModelEnabled ? (["supportsBrowserAction"] as const) : []),
								"supportsPromptCache",
								"supportsTools",
								"temperature",
							],
							pricing: ["inputPrice", "outputPrice", "cacheWritesPrice", "cacheReadsPrice", "pricingTiers"],
						}}
						onCapabilitiesUpdate={handleCapabilitiesUpdate}
						onPricingUpdate={handlePricingUpdate}
						pricing={pc.pricing}
						pricingTiersEnabled={pc.pricingTiersEnabled === true}
						tiersEditable={true}
					/>
				</>
			)}

			<ProfileSection>
				<div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
					<ProfileSectionTitle>Custom Headers</ProfileSectionTitle>
					<ProfileActionRow>
						<VSCodeButton onClick={addHeader}>Add Header</VSCodeButton>
					</ProfileActionRow>
				</div>
				{headerEntries.map(([key, value], index) => {
					const nameId = `${fieldId}-header-${index}-name`
					const valueId = `${fieldId}-header-${index}-value`
					return (
						<div
							className="grid min-w-0 grid-cols-1 gap-2 xs:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
							data-testid="custom-header-row"
							key={`${key}-${index}`}>
							<ProfileField htmlFor={nameId} label="Header name">
								<DebouncedTextField
									ariaLabel="Header name"
									className="min-h-7 w-full"
									id={nameId}
									initialValue={key}
									onChange={(newValue) => updateHeader(key, newValue, value)}
									placeholder="Header name"
								/>
							</ProfileField>
							<ProfileField htmlFor={valueId} label="Header value">
								<DebouncedTextField
									ariaLabel="Header value"
									className="min-h-7 w-full"
									id={valueId}
									initialValue={value}
									onChange={(newValue) => updateHeader(key, key, newValue)}
									placeholder="Header value"
								/>
							</ProfileField>
							<ProfileActionRow className="justify-end xs:self-end">
								<VSCodeButton appearance="secondary" onClick={() => removeHeader(key)}>
									Remove
								</VSCodeButton>
							</ProfileActionRow>
						</div>
					)
				})}
			</ProfileSection>

			<BaseUrlField
				initialValue={pc.azureApiVersion}
				label="Set Azure API version"
				onChange={(value) => onUpdate({ openai: { ...pc, azureApiVersion: value } })}
				placeholder="Default: 2024-10-01-preview"
			/>

			<VSCodeCheckbox
				checked={pc.azureIdentity ?? false}
				onChange={(event: Event | React.FormEvent<HTMLElement>) =>
					onUpdate({
						openai: { ...pc, azureIdentity: (event.target as HTMLInputElement | null)?.checked === true },
					})
				}>
				Use Azure Identity Authentication
			</VSCodeCheckbox>

			<VSCodeCheckbox
				checked={pc.streamIncludeUsage ?? true}
				onChange={(event: Event | React.FormEvent<HTMLElement>) =>
					onUpdate({
						openai: { ...pc, streamIncludeUsage: (event.target as HTMLInputElement | null)?.checked === true },
					})
				}>
				Include usage stats in stream responses
			</VSCodeCheckbox>

			<ProfileField
				description="Abort and retry when no Responses streaming event is received for this many seconds."
				htmlFor={streamIdleTimeoutId}
				label="Responses stream idle timeout (seconds)">
				<DebouncedTextField
					ariaLabel="Responses stream idle timeout (seconds)"
					className="min-h-7 w-full"
					id={streamIdleTimeoutId}
					initialValue={String(pc.streamIdleTimeoutSeconds ?? DEFAULT_OPENAI_RESPONSES_STREAM_IDLE_TIMEOUT_SECONDS)}
					onChange={handleStreamIdleTimeoutChange}
					placeholder={String(DEFAULT_OPENAI_RESPONSES_STREAM_IDLE_TIMEOUT_SECONDS)}
				/>
			</ProfileField>

			{compatibilityNotice ? (
				<ProfileNotice title={compatibilityNotice.title} variant={compatibilityNotice.variant}>
					{compatibilityNotice.message}
				</ProfileNotice>
			) : null}

			{showModelOptions && <ModelInfoView isPopup={isPopup} modelInfo={modelInfo} selectedModelId={modelId} />}
		</div>
	)
}
