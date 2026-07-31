import type { OcaModelInfo } from "@shared/api"
import { StringRequest } from "@shared/proto/dline/common"
import type { ModelInfo } from "@shared/proto/dline/models"
import { OcaModelInfo as ProtoOcaModelInfo } from "@shared/proto/dline/models"
import type { ApiProfile } from "@shared/proto/dline/profile"
import { VSCodeButton, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import { ModelsServiceClient } from "@/services/grpc-client"
import { VSC_BUTTON_BACKGROUND, VSC_BUTTON_FOREGROUND, VSC_DESCRIPTION_FOREGROUND, VSC_FOREGROUND } from "@/utils/vscStyles"
import { ModelInfoView } from "../common/ModelInfoView"
import ThinkingBudgetSlider from "../ThinkingBudgetSlider"

/** Convert proto OcaModelInfo (flat) to app OcaModelInfo (layered capabilities/pricing). */
function protoToAppOcaModelInfo(proto: ProtoOcaModelInfo, modelId: string): OcaModelInfo {
	return {
		id: modelId,
		description: proto.description,
		modelName: proto.modelName ?? modelId,
		apiFormats: proto.apiFormat !== undefined ? [proto.apiFormat] : undefined,
		surveyId: proto.surveyId,
		surveyContent: proto.surveyContent,
		banner: proto.banner,
		supportsReasoning: proto.supportsReasoning,
		reasoningEffortOptions: proto.reasoningEffortOptions,
		capabilities: {
			supportsImages: proto.supportsImages ?? false,
			supportsPromptCache: proto.supportsPromptCache,
			supportsReasoning: proto.supportsReasoning,
			maxTokens: proto.maxTokens,
			contextWindow: proto.contextWindow,
			thinking: proto.thinkingConfig
				? {
						supported: true,
						mode: (proto.thinkingConfig.maxBudget !== undefined ? "budget" : "effort") as "budget" | "effort",
						maxBudget: proto.thinkingConfig.maxBudget,
						effortLevels: proto.thinkingConfig.effortLevels ?? [],
					}
				: undefined,
		},
		pricing: {
			inputPrice: proto.inputPrice,
			outputPrice: proto.outputPrice,
			cacheWritesPrice: proto.cacheWritesPrice,
			cacheReadsPrice: proto.cacheReadsPrice,
		},
	}
}

/** Convert app OcaModelInfo to proto ModelInfo for profile storage. */
function ocaToModelInfo(oca: OcaModelInfo, modelId: string): ModelInfo {
	return {
		id: modelId,
		capabilities: oca.capabilities,
		pricing: oca.pricing,
		description: oca.description,
		apiFormats: oca.apiFormats,
	}
}

export interface OcaModelPickerProps {
	showModelOptions: boolean
	isPopup?: boolean
	profile: ApiProfile
	onUpdate: (updates: Partial<ApiProfile>) => void
}

/** OCA model picker — profile-driven. Uses OcaModelInfo for banner/reasoningEffortOptions. */
const OcaModelPicker: React.FC<OcaModelPickerProps> = ({ showModelOptions, isPopup, profile, onUpdate }) => {
	const [ocaModels, setOcaModels] = useState<Record<string, OcaModelInfo>>({})
	const [loading, setLoading] = useState(false)
	const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null)
	const [pendingModelId, setPendingModelId] = useState<string | null>(null)
	const [showRestrictedPopup, setShowRestrictedPopup] = useState(false)

	const selectedModelId = profile.modelId || ""
	const selectedModelInfo = profile.modelInfo

	const refreshOcaModels = useCallback(async () => {
		setLoading(true)
		try {
			const resp = await ModelsServiceClient.refreshOcaModels(StringRequest.create({ value: profile.baseUrl || "" }))
			if (resp.models) {
				const models: Record<string, OcaModelInfo> = {}
				for (const [key, value] of Object.entries(resp.models)) {
					models[key] = protoToAppOcaModelInfo(value, key)
				}
				setOcaModels(models)
			}
			setLastRefreshedAt(Date.now())
		} catch {
			// Error handled silently — retry available via refresh button
		} finally {
			setLoading(false)
		}
	}, [profile.baseUrl])

	useEffect(() => {
		refreshOcaModels()
	}, [refreshOcaModels])

	const handleModelChange = (newModelId: string) => {
		const oca = ocaModels[newModelId]
		if (!oca) return
		if (oca.banner) {
			setPendingModelId(newModelId)
			setShowRestrictedPopup(true)
		} else {
			onUpdate({ modelId: newModelId, modelInfo: ocaToModelInfo(oca, newModelId) })
		}
	}

	const onAcknowledge = () => {
		if (pendingModelId && ocaModels[pendingModelId]) {
			const oca = ocaModels[pendingModelId]
			onUpdate({ modelId: pendingModelId, modelInfo: ocaToModelInfo(oca, pendingModelId) })
			setPendingModelId(null)
			setShowRestrictedPopup(false)
		}
	}

	const reasoningEffortOptions: string[] = (ocaModels[selectedModelId]?.reasoningEffortOptions as string[] | undefined) ?? []

	const modelIds = useMemo(() => Object.keys(ocaModels).sort((a, b) => a.localeCompare(b)), [ocaModels])
	const showBudgetSlider = useMemo(() => !!selectedModelInfo?.capabilities?.thinking, [selectedModelInfo])
	const lastRefreshedText = useMemo(
		() => (typeof lastRefreshedAt === "number" ? new Date(lastRefreshedAt).toLocaleTimeString() : null),
		[lastRefreshedAt],
	)
	const pendingBanner = pendingModelId ? ocaModels[pendingModelId]?.banner : undefined

	return (
		<div className="w-full">
			{showRestrictedPopup && <OcaRestrictivePopup bannerText={pendingBanner} onAcknowledge={onAcknowledge} />}
			<style>{`#model-id::part(listbox){max-height:100px;overflow:auto;}`}</style>
			<label className="font-medium text-[12px] mt-[10px] mb-[2px]">Model</label>
			<div className="relative z-100 flex items-center gap-2 mb-1">
				<VSCodeDropdown
					className="flex-1 text-[12px] min-h-[24px]"
					id="model-id"
					onChange={(event: Event | React.FormEvent<HTMLElement>) => {
						const v = (event.target as HTMLSelectElement | null)?.value ?? ""
						handleModelChange(v)
					}}
					style={{ position: "relative", zIndex: 100 }}
					value={selectedModelId || ""}>
					{modelIds.map((id) => (
						<VSCodeOption key={id} style={{ padding: "4px 8px", fontSize: 12 }} value={id}>
							{id}
						</VSCodeOption>
					))}
				</VSCodeDropdown>
				<VSCodeButton
					disabled={loading}
					onClick={refreshOcaModels}
					style={{
						fontSize: 14,
						fontWeight: 500,
						background: "var(--vscode-button-background,#0078d4)",
						color: "var(--vscode-button-foreground,#fff)",
						minWidth: 0,
						margin: 0,
					}}>
					{loading ? "Refreshing…" : "Refresh"}
				</VSCodeButton>
			</div>
			{lastRefreshedText && (
				<div className="text-[11px] text-(--vscode-descriptionForeground) mt-0 mb-2">
					Last refreshed at {lastRefreshedText}
				</div>
			)}
			{!loading && selectedModelInfo?.capabilities?.supportsReasoning && reasoningEffortOptions.length > 0 && (
				<>
					<label className="font-medium text-[12px] mt-[10px] mb-[2px]">Reasoning Effort</label>
					<div className="flex items-center gap-2 mb-1">
						<VSCodeDropdown
							className="flex-1 text-[12px] min-h-[24px]"
							id="reasoning-effort-dropdown"
							onChange={(e: Event | React.FormEvent<HTMLElement>) => {
								const v = (e.target as HTMLSelectElement | null)?.value ?? ""
								onUpdate({ modelId: profile.modelId, modelInfo: profile.modelInfo })
							}}>
							{reasoningEffortOptions.map((effort) => (
								<VSCodeOption key={effort} style={{ padding: "4px 8px", fontSize: 12 }} value={effort}>
									{effort}
								</VSCodeOption>
							))}
						</VSCodeDropdown>
					</div>
				</>
			)}
			{selectedModelInfo && (
				<>
					{showBudgetSlider && <ThinkingBudgetSlider />}
					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}

export default OcaModelPicker

const OcaRestrictivePopup: React.FC<{ onAcknowledge: () => void; bannerText?: string | null }> = React.memo(
	({ onAcknowledge, bannerText }) => (
		<div className="fixed top-0 left-0 w-screen h-screen z-2000 [background:rgba(0,0,0,0.25)] flex items-center justify-center">
			<div
				aria-labelledby="oca-popup-title"
				aria-modal="true"
				className={`p-6 max-w-[600px] w-[90%] rounded-[8px] [box-shadow:0_4px_24px_0_var(--vscode-widget-shadow,rgba(0,0,0,.4))] [border:1px_solid_var(--vscode-focusBorder,#007acc)] [background:var(--vscode-editor-background,#252526)] [color:var(${VSC_FOREGROUND},#cccccc)] [font-family:var(--vscode-font-family,sans-serif)] [font-size:var(--vscode-font-size,13px)] flex flex-col max-h-[80vh]`}
				role="dialog">
				<h2 className={`mt-0 [color:var(${VSC_FOREGROUND},#111)] font-bold`} id="oca-popup-title">
					Acknowledgement Required
				</h2>
				<h4 className={`mb-2 [color:var(${VSC_DESCRIPTION_FOREGROUND},#b3b3b3)] font-semibold`}>
					Disclaimer: Prohibited Data Submission
				</h4>
				<div className="overflow-y-auto flex-1 pr-2 mb-4 text-[13px] leading-normal text-(--vscode-foreground,#222) mask-[linear-gradient(to_bottom,black_96%,transparent_100%)]">
					{bannerText && <div dangerouslySetInnerHTML={{ __html: bannerText }} />}
				</div>
				<div className="text-right">
					<VSCodeButton
						onClick={onAcknowledge}
						style={{
							background: `var(${VSC_BUTTON_BACKGROUND},#0e639c)`,
							color: `var(${VSC_BUTTON_FOREGROUND},#fff)`,
						}}
						type="button">
						I acknowledge and agree
					</VSCodeButton>
				</div>
			</div>
		</div>
	),
)
