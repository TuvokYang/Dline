import {
	OpenAiCodexAuthStatus,
	type OpenAiCodexCallbackUriRequest,
	type OpenAiCodexProfileRequest,
} from "@shared/proto/dline/account"
import { ApiProfile } from "@shared/proto/dline/profile"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { cancelOpenAiCodexSignIn } from "./cancelOpenAiCodexSignIn"
import { completeOpenAiCodexCallbackUri } from "./completeOpenAiCodexCallbackUri"
import { getOpenAiCodexAuthStatus } from "./getOpenAiCodexAuthStatus"
import { openAiCodexSignIn as deprecatedOpenAiCodexSignIn } from "./openAiCodexSignIn"
import { openAiCodexSignOut as deprecatedOpenAiCodexSignOut } from "./openAiCodexSignOut"
import { signOutOpenAiCodexProfile } from "./signOutOpenAiCodexProfile"
import { startOpenAiCodexSignIn } from "./startOpenAiCodexSignIn"

const mocks = vi.hoisted(() => ({
	readApiProfilesFresh: vi.fn(),
	startAuthorizationFlow: vi.fn(),
	getAuthStatus: vi.fn(),
	getActiveAuthorizationFlow: vi.fn(),
	completeFromCallbackUri: vi.fn(),
	cancelAuthorizationFlow: vi.fn(),
	clearCredentials: vi.fn(),
	showMessage: vi.fn(),
	loggerError: vi.fn(),
}))

vi.mock("@/core/controller/file/getApiProfiles", () => ({ readApiProfilesFresh: mocks.readApiProfilesFresh }))
vi.mock("@/integrations/openai-codex/oauth", () => ({
	openAiCodexOAuthManager: {
		startAuthorizationFlow: mocks.startAuthorizationFlow,
		getAuthStatus: mocks.getAuthStatus,
		getActiveAuthorizationFlow: mocks.getActiveAuthorizationFlow,
		completeFromCallbackUri: mocks.completeFromCallbackUri,
		cancelAuthorizationFlow: mocks.cancelAuthorizationFlow,
		clearCredentials: mocks.clearCredentials,
	},
}))
vi.mock("@/hosts/host-provider", () => ({ HostProvider: { window: { showMessage: mocks.showMessage } } }))
vi.mock("@/shared/services/Logger", () => ({ Logger: { error: mocks.loggerError } }))

const controller = { postStateToWebview: vi.fn() } as never
const profileA = ApiProfile.create({ id: "profile-a", name: "Codex A", provider: "openai-codex", enabled: true })
const profileB = ApiProfile.create({ id: "profile-b", name: "OpenAI B", provider: "openai", enabled: true })
const credentials = {
	access_token: "access-token",
	refresh_token: "refresh-token",
	expires: 1_900_000_000_000,
}

function profileRequest(profileId = profileA.id): OpenAiCodexProfileRequest {
	return { profileId }
}

describe("OpenAI Codex Profile OAuth handlers", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.readApiProfilesFresh.mockResolvedValue([profileA, profileB])
		mocks.startAuthorizationFlow.mockResolvedValue({
			profileId: profileA.id,
			flowId: "flow-a",
			result: new Promise(() => undefined),
		})
		mocks.getAuthStatus.mockResolvedValue("missing")
		mocks.getActiveAuthorizationFlow.mockReturnValue(undefined)
		mocks.completeFromCallbackUri.mockResolvedValue(credentials)
		mocks.cancelAuthorizationFlow.mockResolvedValue(undefined)
		mocks.clearCredentials.mockResolvedValue(undefined)
	})

	it("starts a browser flow for the explicit Profile and returns only owner identifiers", async () => {
		await expect(startOpenAiCodexSignIn(controller, profileRequest())).resolves.toEqual({
			profileId: "profile-a",
			flowId: "flow-a",
		})
		expect(mocks.startAuthorizationFlow).toHaveBeenCalledWith("profile-a")
	})

	it("rejects missing and non-Codex Profile targets before touching OAuth state", async () => {
		await expect(startOpenAiCodexSignIn(controller, profileRequest(""))).rejects.toThrow("OpenAI Codex Profile")
		await expect(startOpenAiCodexSignIn(controller, profileRequest("profile-b"))).rejects.toThrow("OpenAI Codex Profile")
		expect(mocks.startAuthorizationFlow).not.toHaveBeenCalled()
	})

	it("keeps the deprecated Empty RPCs fail-closed without inferring an active Profile", async () => {
		await expect(deprecatedOpenAiCodexSignIn(controller, {})).rejects.toThrow("Profile-targeted RPC")
		await expect(deprecatedOpenAiCodexSignOut(controller, {})).rejects.toThrow("Profile-targeted RPC")
		expect(mocks.startAuthorizationFlow).not.toHaveBeenCalled()
		expect(mocks.clearCredentials).not.toHaveBeenCalled()
	})

	it("maps the Profile session status to a secret-free protobuf enum", async () => {
		mocks.getAuthStatus.mockResolvedValue("legacy-shared")
		mocks.getActiveAuthorizationFlow.mockReturnValue({ profileId: "profile-a", flowId: "flow-a" })
		await expect(getOpenAiCodexAuthStatus(controller, profileRequest())).resolves.toEqual({
			profileId: "profile-a",
			status: OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_LEGACY_SHARED,
			flowId: "flow-a",
		})
	})

	it("uses the same Profile and flow owner for callback completion and cancellation", async () => {
		const request: OpenAiCodexCallbackUriRequest = {
			profileId: "profile-a",
			flowId: "flow-a",
			callbackUri: "http://localhost:1455/auth/callback?code=secret-code&state=secret-state",
		}
		mocks.getAuthStatus.mockResolvedValue("authenticated")

		await expect(completeOpenAiCodexCallbackUri(controller, request)).resolves.toEqual({
			profileId: "profile-a",
			status: OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_AUTHENTICATED,
			flowId: "",
		})
		expect(mocks.completeFromCallbackUri).toHaveBeenCalledWith(request)

		await cancelOpenAiCodexSignIn(controller, { profileId: "profile-a", flowId: "flow-a" })
		expect(mocks.cancelAuthorizationFlow).toHaveBeenCalledWith("profile-a", "flow-a")
	})

	it("signs out only the explicit Codex Profile", async () => {
		await signOutOpenAiCodexProfile(controller, profileRequest())
		expect(mocks.clearCredentials).toHaveBeenCalledWith("profile-a")
	})

	it("does not expose callback URI or provider payload through RPC errors or logs", async () => {
		const secret = "code=secret-code&state=secret-state&access_token=secret-token"
		mocks.completeFromCallbackUri.mockRejectedValue(new Error(secret))

		const error = await completeOpenAiCodexCallbackUri(controller, {
			profileId: "profile-a",
			flowId: "flow-a",
			callbackUri: `http://localhost:1455/auth/callback?${secret}`,
		}).catch((caught: unknown) => caught)

		expect(String(error)).not.toContain(secret)
		expect(JSON.stringify(mocks.loggerError.mock.calls)).not.toContain(secret)
	})
})
