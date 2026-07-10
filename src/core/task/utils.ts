import { ApiHandler } from "@core/api"
import { execSync } from "child_process"
import { showApprovalNotification } from "@/integrations/notifications"
import { ClineApiReqCancelReason, ClineApiReqInfo } from "@/shared/ExtensionMessage"
import { calculateApiCostAnthropic } from "@/utils/cost"
import { MessageStateHandler } from "./message-state"

export const showNotificationForApproval = (message: string, notificationsEnabled: boolean) => {
	void showApprovalNotification({ message }, notificationsEnabled)
}

type UpdateApiReqMsgParams = {
	messageStateHandler: MessageStateHandler
	lastApiReqIndex: number
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
	contextTokens: number
	totalCost?: number
	cacheHitRate?: number
	api: ApiHandler
	cancelReason?: ClineApiReqCancelReason
	streamingFailedMessage?: string
}

/**
 * Finalize persisted API request usage and pricing metadata.
 *
 * @param params Normalized request metrics and persistence dependencies.
 * @returns A promise that resolves after the request message is updated.
 */
export const updateApiReqMsg = async (params: UpdateApiReqMsgParams): Promise<void> => {
	const clineMessages = params.messageStateHandler.clineMessages
	const currentApiReqInfo: ClineApiReqInfo = JSON.parse(clineMessages[params.lastApiReqIndex].text || "{}")
	delete currentApiReqInfo.retryStatus // Clear retry status when request is finalized

	const modelInfo = params.api.getModel().info
	const totalInputTokens = params.inputTokens + (params.cacheWriteTokens || 0) + (params.cacheReadTokens || 0)
	const cacheHitRate = params.cacheHitRate ?? (totalInputTokens > 0 ? (params.cacheReadTokens / totalInputTokens) * 100 : 0)

	await params.messageStateHandler.updateClineMessage(params.lastApiReqIndex, {
		text: JSON.stringify({
			...currentApiReqInfo, // Spread the modified info (with retryStatus removed)
			contextTokens: params.contextTokens,
			tokensIn: params.inputTokens,
			tokensOut: params.outputTokens,
			cacheWrites: params.cacheWriteTokens,
			cacheReads: params.cacheReadTokens,
			cost:
				params.totalCost ??
				calculateApiCostAnthropic(
					modelInfo,
					params.inputTokens,
					params.outputTokens,
					params.cacheWriteTokens,
					params.cacheReadTokens,
				),
			cacheHitRate: Math.round(cacheHitRate * 100) / 100, // Round to 2 decimal places
			currency: modelInfo.pricing?.currency || "USD",
			inputPrice: modelInfo.pricing?.inputPrice,
			outputPrice: modelInfo.pricing?.outputPrice,
			cancelReason: params.cancelReason,
			streamingFailedMessage: params.streamingFailedMessage,
		} satisfies ClineApiReqInfo),
	})
}

/**
 * Common CLI tools that developers frequently use
 */
const CLI_TOOLS = [
	"gh",
	"git",
	"docker",
	"podman",
	"kubectl",
	"aws",
	"gcloud",
	"az",
	"terraform",
	"pulumi",
	"npm",
	"yarn",
	"pnpm",
	"pip",
	"cargo",
	"go",
	"curl",
	"jq",
	"make",
	"cmake",
	"python",
	"node",
	"psql",
	"mysql",
	"redis-cli",
	"sqlite3",
	"mongosh",
	"code",
	"grep",
	"sed",
	"awk",
	"brew",
	"apt",
	"yum",
	"gradle",
	"mvn",
	"bundle",
	"dotnet",
	"helm",
	"ansible",
	"wget",
]

/**
 * Detect which CLI tools are available in the system PATH
 * Uses 'which' command on Unix-like systems and 'where' on Windows
 */
export async function detectAvailableCliTools(): Promise<string[]> {
	const availableCommands: string[] = []
	const isWindows = process.platform === "win32"
	const checkCommand = isWindows ? "where" : "which"

	for (const command of CLI_TOOLS) {
		try {
			// Use execSync to check if the command exists
			execSync(`${checkCommand} ${command}`, {
				stdio: "ignore", // Don't output to console
				timeout: 1000, // 1 second timeout to avoid hanging
			})
			availableCommands.push(command)
		} catch (_error) {
			// Command not found, skip it
		}
	}

	return availableCommands
}

/**
 * Extracts the domain from a provider URL string
 * @param url The URL to extract domain from
 * @returns The domain/hostname or undefined if invalid
 */
export function extractProviderDomainFromUrl(url: string | undefined): string | undefined {
	if (!url) {
		return undefined
	}
	try {
		const urlObj = new URL(url)
		return urlObj.hostname
	} catch {
		return undefined
	}
}
