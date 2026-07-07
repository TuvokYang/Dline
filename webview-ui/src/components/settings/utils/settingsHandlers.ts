import { McpDisplayMode, Settings, UpdateSettingsRequest, UpdateTaskSettingsRequest } from "@shared/proto/dline/state"
import { StateServiceClient } from "@/services/grpc-client"

/**
 * Converts values to their corresponding proto format
 * @param field - The field name
 * @param value - The value to convert
 * @returns The converted value
 * @throws Error if the value is invalid for the field
 */
const convertToProtoValue = (field: keyof UpdateSettingsRequest, value: any): any => {
	if (field === "mcpDisplayMode" && typeof value === "string") {
		switch (value) {
			case "rich":
				return McpDisplayMode.RICH
			case "plain":
				return McpDisplayMode.PLAIN
			case "markdown":
				return McpDisplayMode.MARKDOWN
			default:
				throw new Error(`Invalid MCP display mode value: ${value}`)
		}
	}
	return value
}

/**
 * Updates a single field in the settings.
 *
 * @param field - The field key to update
 * @param value - The new value for the field
 */
export const updateSetting = (field: keyof UpdateSettingsRequest, value: any) => {
	const updateRequest: Partial<UpdateSettingsRequest> = {}

	const convertedValue = convertToProtoValue(field, value)
	updateRequest[field] = convertedValue

	StateServiceClient.updateSettings(UpdateSettingsRequest.create(updateRequest)).catch((error) => {
		console.error(`Failed to update setting ${field}:`, error)
	})
}

/**
 * Updates a task-level setting for a specific task.
 * Used when you want to override global settings for a particular task.
 *
 * @param taskId - The task ID to update settings for
 * @param field - The settings field to update (e.g., "planModeProfile", "actModeProfile")
 * @param value - The new value for the field
 */
export const updateTaskSetting = (taskId: string, field: keyof Settings, value: any) => {
	updateTaskSettings(taskId, { [field]: value })
}

/**
 * Updates multiple task-level settings for a specific task.
 *
 * @param taskId - The task ID to update settings for
 * @param settings - The task-level settings to update in one request
 */
export const updateTaskSettings = (taskId: string, settings: Partial<Settings>) => {
	const request = UpdateTaskSettingsRequest.create({
		taskId,
		settings,
	})

	StateServiceClient.updateTaskSettings(request).catch((error) => {
		console.error(`Failed to update task settings for task ${taskId}:`, error)
	})
}
