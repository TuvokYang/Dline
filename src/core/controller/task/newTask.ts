import { String } from "@shared/proto/dline/common"
import { PlanActMode } from "@shared/proto/dline/state"
import { NewTaskRequest } from "@shared/proto/dline/task"
import { Settings } from "@shared/storage/state-keys"
import { DEFAULT_BROWSER_SETTINGS } from "../../../shared/BrowserSettings"
import { Controller } from ".."
import { normalizeOpenaiReasoningEffort } from "../state/reasoningEffort"

/**
 * Creates a new task with the given text and optional images
 * @param controller The controller instance
 * @param request The new task request containing text and optional images, and optional task settings
 * @returns Empty response
 */
export async function newTask(controller: Controller, request: NewTaskRequest): Promise<String> {
	const convertPlanActMode = (mode: PlanActMode): string => {
		return mode === PlanActMode.PLAN ? "plan" : "act"
	}

	// Proto-generated taskSettings may not include all runtime fields;
	// use unknown→Record for fields not in the generated type.
	const filteredTaskSettings: Partial<Settings> = Object.fromEntries(
		Object.entries({
			...request.taskSettings,
			...(request.taskSettings?.autoApprovalSettings && {
				autoApprovalSettings: (() => {
					// Merge with global settings to ensure complete settings for new task
					const globalSettings = controller.stateManager.getGlobalSettingsKey("autoApprovalSettings")
					const incomingSettings = request.taskSettings.autoApprovalSettings
					return {
						...globalSettings,
						...(incomingSettings.version !== undefined && { version: incomingSettings.version }),
						...(incomingSettings.enableNotifications !== undefined && {
							enableNotifications: incomingSettings.enableNotifications,
						}),
						actions: {
							...globalSettings.actions,
							...(incomingSettings.actions
								? Object.fromEntries(Object.entries(incomingSettings.actions).filter(([_, v]) => v !== undefined))
								: {}),
						},
					}
				})(),
			}),
			...(request.taskSettings?.browserSettings && {
				browserSettings: {
					viewport: request.taskSettings.browserSettings.viewport || DEFAULT_BROWSER_SETTINGS.viewport,
					remoteBrowserHost: request.taskSettings.browserSettings.remoteBrowserHost,
					remoteBrowserEnabled: request.taskSettings.browserSettings.remoteBrowserEnabled,
					chromeExecutablePath: request.taskSettings.browserSettings.chromeExecutablePath,
					disableToolUse: request.taskSettings.browserSettings.disableToolUse,
					customArgs: request.taskSettings.browserSettings.customArgs,
				},
			}),
			...(request.taskSettings?.planModeReasoningEffort !== undefined && {
				planModeReasoningEffort: normalizeOpenaiReasoningEffort(request.taskSettings.planModeReasoningEffort),
			}),
			...(request.taskSettings?.actModeReasoningEffort !== undefined && {
				actModeReasoningEffort: normalizeOpenaiReasoningEffort(request.taskSettings.actModeReasoningEffort),
			}),
			...(request.taskSettings?.mode !== undefined && {
				mode: convertPlanActMode(request.taskSettings.mode),
			}),
			...(request.taskSettings?.customPrompt === "compact" && {
				customPrompt: "compact",
			}),
			...(typeof request.taskSettings?.planModeProfile === "string" && {
				planModeProfile: request.taskSettings.planModeProfile,
			}),
			...(typeof request.taskSettings?.actModeProfile === "string" && {
				actModeProfile: request.taskSettings.actModeProfile,
			}),
		}).filter(([_, value]) => value !== undefined),
	)

	const taskId = await controller.initTask(request.text, request.images, request.files, undefined, filteredTaskSettings)
	return String.create({ value: taskId || "" })
}
