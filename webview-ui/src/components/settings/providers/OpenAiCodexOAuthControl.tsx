import { OpenAiCodexAuthStatus } from "@shared/proto/dline/account"
import { CheckCircle2Icon, CircleDashedIcon, LoaderIcon, TriangleAlertIcon } from "lucide-react"
import type { ReactNode } from "react"
import { ProfileActionRow, ProfileNotice, ProfileSection } from "../profile-ui"
import { OpenAiCodexOAuthDialog } from "./OpenAiCodexOAuthDialog"
import { isOpenAiCodexAuthenticated, useOpenAiCodexOAuthFlow } from "./useOpenAiCodexOAuthFlow"

/**
 * Native buttons keep the control keyboard and screen-reader accessible.
 *
 * The toolkit's `<vscode-button>` custom element does not expose a button role outside a browser
 * runtime, so it cannot be targeted by role in tests or by assistive technology in the webview.
 */
const BUTTON_BASE_CLASS =
	"min-h-7 cursor-pointer rounded-xs px-3 text-sm transition-colors disabled:cursor-default disabled:opacity-50"
const PRIMARY_BUTTON_CLASS = `${BUTTON_BASE_CLASS} bg-button-background text-button-foreground hover:bg-button-background-hover disabled:hover:bg-button-background`
const SECONDARY_BUTTON_CLASS = `${BUTTON_BASE_CLASS} bg-button-secondary-background text-button-secondary-foreground hover:bg-button-secondary-background-hover disabled:hover:bg-button-secondary-background`

/**
 * Severity of an authentication state.
 *
 * `normal` states are expected outcomes and stay inline so they do not compete with the sign-in
 * action. `attention` states require the user to act and are promoted to a full notice.
 */
type StatusSeverity = "normal" | "attention"

interface StatusPresentation {
	label: string
	severity: StatusSeverity
	/** Shown only for attention states, where the user needs to know what to do next. */
	guidance?: string
}

function statusPresentation(status: OpenAiCodexAuthStatus): StatusPresentation {
	switch (status) {
		case OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_AUTHENTICATED:
			return { label: "Signed in", severity: "normal" }
		case OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_REFRESHABLE_EXPIRED:
			return { label: "Signed in · refreshing", severity: "normal" }
		case OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_LEGACY_SHARED:
			return {
				label: "Sign-in required",
				severity: "attention",
				guidance: "This profile needs its own ChatGPT sign-in.",
			}
		case OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_MALFORMED:
			return {
				label: "Invalid credential",
				severity: "attention",
				guidance: "The stored credential cannot be read. Sign in again.",
			}
		case OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_REAUTHENTICATION_REQUIRED:
			return {
				label: "Sign-in expired",
				severity: "attention",
				guidance: "The credential can no longer refresh. Sign in again.",
			}
		case OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_MISSING:
			return { label: "Not signed in", severity: "normal" }
		default:
			return { label: "Checking", severity: "normal" }
	}
}

function statusIcon(status: OpenAiCodexAuthStatus, severity: StatusSeverity, checking: boolean): ReactNode {
	if (checking) return <LoaderIcon className="size-3.5 animate-spin" />
	if (severity === "attention") return <TriangleAlertIcon className="size-3.5 text-editor-warning-foreground" />
	if (isOpenAiCodexAuthenticated(status)) return <CheckCircle2Icon className="size-3.5 text-success" />
	return <CircleDashedIcon className="size-3.5" />
}

export function OpenAiCodexOAuthControl({ profileId }: { profileId: string }) {
	const flow = useOpenAiCodexOAuthFlow(profileId)
	const authenticated = isOpenAiCodexAuthenticated(flow.status)
	const presentation = statusPresentation(flow.status)
	const inProgress = flow.dialog.phase === "starting" || flow.dialog.phase === "active" || flow.dialog.phase === "completing"
	const checking = !inProgress && flow.status === OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_UNSPECIFIED
	const label = inProgress ? "Signing in" : presentation.label
	const actionsDisabled = flow.busy || inProgress
	const blockingError = flow.statusError ?? (flow.dialog.phase === "closed" ? flow.actionError : undefined)

	return (
		<ProfileSection aria-label="ChatGPT account">
			<ProfileActionRow className="justify-between">
				<span className="flex min-w-0 items-center gap-1.5 text-xs text-description">
					<span aria-hidden="true" className="flex shrink-0 items-center">
						{statusIcon(flow.status, presentation.severity, checking || inProgress)}
					</span>
					<span className="truncate">ChatGPT: {label}</span>
				</span>
				<span className="flex shrink-0 items-center gap-2">
					<button
						className={authenticated ? SECONDARY_BUTTON_CLASS : PRIMARY_BUTTON_CLASS}
						disabled={actionsDisabled}
						onClick={() => void flow.start()}
						type="button">
						{authenticated ? "Sign in again" : "Sign in"}
					</button>
					{authenticated ? (
						<button
							className={SECONDARY_BUTTON_CLASS}
							disabled={actionsDisabled}
							onClick={() => void flow.signOut()}
							type="button">
							Sign out
						</button>
					) : null}
				</span>
			</ProfileActionRow>
			{presentation.severity === "attention" && !inProgress ? (
				<ProfileNotice variant="warning">{presentation.guidance}</ProfileNotice>
			) : null}
			{blockingError ? <ProfileNotice variant="error">{blockingError}</ProfileNotice> : null}
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
