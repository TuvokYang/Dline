import { OpenAiCodexAuthStatus } from "@shared/proto/dline/account"
import { ProfileActionRow, ProfileNotice, ProfileSection } from "../profile-ui"
import { OpenAiCodexOAuthDialog } from "./OpenAiCodexOAuthDialog"
import { isOpenAiCodexAuthenticated, useOpenAiCodexOAuthFlow } from "./useOpenAiCodexOAuthFlow"

function statusPresentation(status: OpenAiCodexAuthStatus): { title: string; detail: string; warning: boolean } {
	switch (status) {
		case OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_AUTHENTICATED:
			return { title: "已认证", detail: "当前Profile的OAUTH凭据可用，Dline会在需要时自动刷新。", warning: false }
		case OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_REFRESHABLE_EXPIRED:
			return { title: "等待自动刷新", detail: "将在下一次请求前自动刷新当前Profile凭据。", warning: false }
		case OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_LEGACY_SHARED:
			return { title: "需要独立认证", detail: "请为当前Profile创建独立OAUTH凭据。", warning: true }
		case OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_MALFORMED:
			return { title: "凭据无效", detail: "当前Profile的凭据无法读取，请重新认证。", warning: true }
		case OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_REAUTHENTICATION_REQUIRED:
			return { title: "需要重新认证", detail: "凭据无法继续自动刷新，请重新完成OAUTH认证。", warning: true }
		case OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_MISSING:
			return { title: "未认证", detail: "当前Profile尚未连接ChatGPT账户。", warning: false }
		default:
			return { title: "正在检查认证状态", detail: "正在读取当前Profile的OAUTH凭据状态。", warning: false }
	}
}

export function OpenAiCodexOAuthControl({ profileId }: { profileId: string }) {
	const flow = useOpenAiCodexOAuthFlow(profileId)
	const authenticated = isOpenAiCodexAuthenticated(flow.status)
	const presentation = statusPresentation(flow.status)
	const inProgress = flow.dialog.phase === "starting" || flow.dialog.phase === "active" || flow.dialog.phase === "completing"

	return (
		<ProfileSection aria-label="OpenAI Codex OAUTH 认证">
			<ProfileNotice
				title={inProgress ? "OAUTH 认证进行中" : presentation.title}
				variant={presentation.warning ? "warning" : "info"}>
				{inProgress ? "正在等待浏览器授权完成。" : presentation.detail}
			</ProfileNotice>
			{flow.statusError ? <ProfileNotice variant="error">{flow.statusError}</ProfileNotice> : null}
			{flow.actionError && flow.dialog.phase === "closed" ? (
				<ProfileNotice variant="error">{flow.actionError}</ProfileNotice>
			) : null}
			<ProfileActionRow className="justify-start">
				<button
					className="min-h-7 rounded-xs bg-button px-3 text-sm text-button-foreground"
					disabled={flow.busy || inProgress}
					onClick={() => void flow.start()}
					type="button">
					{authenticated ? "重新进行 OAUTH 认证" : "开始 OAUTH 认证"}
				</button>
				{authenticated ? (
					<button
						className="min-h-7 rounded-xs border border-button-border px-3 text-sm"
						disabled={flow.busy || inProgress}
						onClick={() => void flow.signOut()}
						type="button">
						退出认证
					</button>
				) : null}
			</ProfileActionRow>
			<OpenAiCodexOAuthDialog
				busy={flow.busy}
				error={flow.actionError}
				flow={flow.dialog.flow}
				onCancel={flow.cancel}
				onComplete={flow.complete}
				onImport={flow.importCredential}
				onRestart={flow.start}
				onTimedOut={flow.markTimedOut}
				open={flow.dialog.phase !== "closed"}
				phase={flow.dialog.phase}
			/>
		</ProfileSection>
	)
}
