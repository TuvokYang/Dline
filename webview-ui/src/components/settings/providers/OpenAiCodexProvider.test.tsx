import {
	type OpenAiCodexAuthFlow,
	OpenAiCodexAuthStatus,
	OpenAiCodexBrowserOpenStatus,
	OpenAiCodexFlowStatus,
} from "@shared/proto/dline/account"
import { ApiProfile } from "@shared/proto/dline/profile"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { OpenAiCodexProvider } from "./OpenAiCodexProvider"

const mocks = vi.hoisted(() => ({
	getStatus: vi.fn(),
	signIn: vi.fn(),
	complete: vi.fn(),
	importOAuthJson: vi.fn(),
	cancel: vi.fn(),
	signOut: vi.fn(),
	copyToClipboard: vi.fn(),
	openInBrowser: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	AccountServiceClient: {
		getOpenAiCodexAuthStatus: mocks.getStatus,
		startOpenAiCodexSignIn: mocks.signIn,
		completeOpenAiCodexCallbackUri: mocks.complete,
		importOpenAiCodexCredentialJson: mocks.importOAuthJson,
		cancelOpenAiCodexSignIn: mocks.cancel,
		signOutOpenAiCodexProfile: mocks.signOut,
	},
	FileServiceClient: { copyToClipboard: mocks.copyToClipboard },
	WebServiceClient: { openInBrowser: mocks.openInBrowser },
}))

vi.mock("./useProviderModels", () => ({
	useProviderModels: () => ({ models: {}, defaultModelId: "gpt-5-codex", modelInfoSaneDefaults: {} }),
}))

const profile = ApiProfile.create({
	id: "profile-a",
	name: "Codex A",
	provider: "openai-codex",
	modelId: "gpt-5-codex",
	enabled: true,
})

function renderProvider() {
	return render(<OpenAiCodexProvider onUpdate={vi.fn()} profile={profile} showModelOptions={false} />)
}

const profileB = ApiProfile.create({ ...profile, id: "profile-b", name: "Codex B" })

const activeFlow: OpenAiCodexAuthFlow = {
	profileId: profile.id,
	flowId: "flow-a",
	authorizationUrl:
		"https://auth.example.test/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&state=transient-state",
	redirectUri: "http://localhost:1455/auth/callback",
	expiresAtMs: Date.now() + 300_000,
	browserOpenStatus: OpenAiCodexBrowserOpenStatus.OPEN_AI_CODEX_BROWSER_OPEN_STATUS_OPENED,
}

describe("OpenAiCodexProvider OAUTH control", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.getStatus.mockResolvedValue({
			profileId: profile.id,
			status: OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_MISSING,
		})
		mocks.signIn.mockResolvedValue(activeFlow)
		mocks.complete.mockResolvedValue({
			profileId: profile.id,
			status: OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_AUTHENTICATED,
		})
		mocks.importOAuthJson.mockResolvedValue({
			profileId: profile.id,
			status: OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_AUTHENTICATED,
		})
		mocks.cancel.mockResolvedValue({})
		mocks.signOut.mockResolvedValue({})
		mocks.copyToClipboard.mockResolvedValue({})
		mocks.openInBrowser.mockResolvedValue({})
	})

	it("keeps the Provider card compact and free of manual credential inputs", async () => {
		renderProvider()
		await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledWith({ profileId: "profile-a" }))
		expect(screen.getByRole("button", { name: "开始 OAUTH 认证" })).toBeInTheDocument()
		expect(screen.queryByText(/Manual input/i)).not.toBeInTheDocument()
		expect(screen.queryByLabelText(/api key|access token|refresh token|oauth json/i)).not.toBeInTheDocument()
	})

	it("opens the OAUTH dialog immediately and then shows the transient authorization URI", async () => {
		let resolveFlow!: (flow: OpenAiCodexAuthFlow) => void
		mocks.signIn.mockReturnValue(new Promise((resolve) => (resolveFlow = resolve)))
		renderProvider()
		fireEvent.click(await screen.findByRole("button", { name: "开始 OAUTH 认证" }))

		expect(screen.getByRole("dialog", { name: "OpenAI Codex OAUTH 认证" })).toBeInTheDocument()
		expect(screen.getByText("正在生成认证 URI…")).toBeInTheDocument()
		await act(async () => resolveFlow(activeFlow))
		expect(await screen.findByLabelText("OpenAI Codex 认证 URI")).toHaveValue(activeFlow.authorizationUrl)
		expect(screen.queryByText(/callback listener/i)).not.toBeInTheDocument()
		expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "完成认证" })).toBeInTheDocument()
	})

	it("copies and reopens the displayed authorization URI through host RPCs", async () => {
		renderProvider()
		fireEvent.click(await screen.findByRole("button", { name: "开始 OAUTH 认证" }))
		await screen.findByLabelText("OpenAI Codex 认证 URI")

		fireEvent.click(screen.getByRole("button", { name: "复制认证 URI" }))
		await waitFor(() =>
			expect(mocks.copyToClipboard).toHaveBeenCalledWith(expect.objectContaining({ value: activeFlow.authorizationUrl })),
		)
		fireEvent.click(screen.getByRole("button", { name: "重新在浏览器中打开" }))
		await waitFor(() =>
			expect(mocks.openInBrowser).toHaveBeenCalledWith(expect.objectContaining({ value: activeFlow.authorizationUrl })),
		)
	})

	it("submits the callback owner, clears the URI before settle, and closes automatically", async () => {
		let resolveCompletion!: (value: object) => void
		const completion = new Promise((resolve) => (resolveCompletion = resolve))
		mocks.complete.mockReturnValue(completion)
		renderProvider()
		fireEvent.click(await screen.findByRole("button", { name: "开始 OAUTH 认证" }))
		const input = await screen.findByRole("textbox", { name: "完整回调 URI" })
		const callbackUri = "http://localhost:1455/auth/callback?code=secret-code&state=secret-state"
		fireEvent.change(input, { target: { value: callbackUri } })
		fireEvent.click(screen.getByRole("button", { name: "完成认证" }))

		expect(mocks.complete).toHaveBeenCalledWith({ profileId: "profile-a", flowId: "flow-a", callbackUri })
		expect(input).toHaveValue("")
		await act(async () => {
			resolveCompletion({ profileId: profile.id, status: OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_AUTHENTICATED })
			await completion
		})
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
	})

	it("keeps OAuth JSON collapsed and compact, clears it before settle, and closes on success", async () => {
		let resolveImport!: (value: object) => void
		const request = new Promise((resolve) => (resolveImport = resolve))
		mocks.importOAuthJson.mockReturnValue(request)
		renderProvider()
		fireEvent.click(await screen.findByRole("button", { name: "开始 OAUTH 认证" }))
		await screen.findByLabelText("OpenAI Codex 认证 URI")
		expect(screen.queryByRole("textbox", { name: "OpenAI Codex OAuth JSON" })).not.toBeInTheDocument()

		fireEvent.click(screen.getByRole("button", { name: /高级：导入 OAuth credential JSON/ }))
		const input = screen.getByRole("textbox", { name: "OpenAI Codex OAuth JSON" })
		expect(input).toHaveClass("h-24", "max-h-24")
		const oauthJson = JSON.stringify({ access_token: "manual-secret", expires: 1_900_000_000_000 })
		fireEvent.change(input, { target: { value: oauthJson } })
		fireEvent.click(screen.getByRole("button", { name: "导入凭据" }))
		expect(mocks.importOAuthJson).toHaveBeenCalledWith({ profileId: "profile-a", oauthJson })
		expect(input).toHaveValue("")

		await act(async () => {
			resolveImport({ profileId: profile.id, status: OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_AUTHENTICATED })
			await request
		})
		await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
	})

	it("shows an explicit timeout and replaces completion with restart", async () => {
		mocks.getStatus.mockResolvedValue({
			profileId: profile.id,
			status: OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_MISSING,
			activeFlow: { ...activeFlow, flowId: "expired-flow", expiresAtMs: Date.now() - 1 },
			lastFlowOutcome: {
				profileId: profile.id,
				flowId: "expired-flow",
				status: OpenAiCodexFlowStatus.OPEN_AI_CODEX_FLOW_STATUS_TIMED_OUT,
				endedAtMs: Date.now(),
			},
		})
		renderProvider()
		expect(await screen.findByText("本次认证已超时，请重新开始。")).toBeInTheDocument()
		expect(screen.getByRole("textbox", { name: "完整回调 URI" })).toBeDisabled()
		expect(screen.getByRole("button", { name: "重新认证" })).toBeInTheDocument()
	})

	it("explains lazy automatic refresh without exposing a Refresh button", async () => {
		mocks.getStatus.mockResolvedValue({
			profileId: profile.id,
			status: OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_REFRESHABLE_EXPIRED,
		})
		renderProvider()
		expect(await screen.findByText("等待自动刷新")).toBeInTheDocument()
		expect(screen.getByText("将在下一次请求前自动刷新当前Profile凭据。")).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: /^refresh$/i })).not.toBeInTheDocument()
	})

	it("cancels only the active Profile flow and signs out only the authenticated Profile", async () => {
		renderProvider()
		fireEvent.click(await screen.findByRole("button", { name: "开始 OAUTH 认证" }))
		await screen.findByLabelText("OpenAI Codex 认证 URI")
		fireEvent.click(screen.getByRole("button", { name: "取消" }))
		await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith({ profileId: "profile-a", flowId: "flow-a" }))

		mocks.getStatus.mockResolvedValue({
			profileId: profile.id,
			status: OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_AUTHENTICATED,
		})
		renderProvider()
		fireEvent.click(await screen.findByRole("button", { name: "退出认证" }))
		await waitFor(() => expect(mocks.signOut).toHaveBeenCalledWith({ profileId: "profile-a" }))
	})

	it("keeps reauthentication open when the existing credential is authenticated and a new flow is active", async () => {
		mocks.getStatus.mockResolvedValue({
			profileId: profile.id,
			status: OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_AUTHENTICATED,
		})
		renderProvider()
		fireEvent.click(await screen.findByRole("button", { name: "重新进行 OAUTH 认证" }))
		await screen.findByLabelText("OpenAI Codex 认证 URI")

		mocks.getStatus.mockResolvedValue({
			profileId: profile.id,
			status: OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_AUTHENTICATED,
			activeFlow,
		})
		await waitFor(() => expect(mocks.getStatus.mock.calls.length).toBeGreaterThan(1), { timeout: 2_500 })

		expect(screen.getByRole("dialog", { name: "OpenAI Codex OAUTH 认证" })).toBeInTheDocument()
		expect(screen.getByLabelText("OpenAI Codex 认证 URI")).toHaveValue(activeFlow.authorizationUrl)
	})

	it("cancels a late start response with its original owner after the Profile changes", async () => {
		let resolveFlow!: (flow: OpenAiCodexAuthFlow) => void
		mocks.signIn.mockReturnValue(new Promise((resolve) => (resolveFlow = resolve)))
		mocks.getStatus.mockImplementation(({ profileId }: { profileId: string }) =>
			Promise.resolve({ profileId, status: OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_MISSING }),
		)
		const view = renderProvider()
		fireEvent.click(await screen.findByRole("button", { name: "开始 OAUTH 认证" }))

		view.rerender(<OpenAiCodexProvider onUpdate={vi.fn()} profile={profileB} showModelOptions={false} />)
		await act(async () => resolveFlow(activeFlow))

		await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith({ profileId: "profile-a", flowId: "flow-a" }))
		expect(screen.queryByDisplayValue(activeFlow.authorizationUrl)).not.toBeInTheDocument()
	})

	it("cancels a late start response after the Provider unmounts", async () => {
		let resolveFlow!: (flow: OpenAiCodexAuthFlow) => void
		mocks.signIn.mockReturnValue(new Promise((resolve) => (resolveFlow = resolve)))
		const view = renderProvider()
		fireEvent.click(await screen.findByRole("button", { name: "开始 OAUTH 认证" }))
		view.unmount()

		await act(async () => resolveFlow(activeFlow))

		await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith({ profileId: "profile-a", flowId: "flow-a" }))
	})

	it("projects a terminal flow failure and removes the stale authorization URI", async () => {
		mocks.complete.mockResolvedValue({
			profileId: profile.id,
			status: OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_MISSING,
			lastFlowOutcome: {
				profileId: profile.id,
				flowId: activeFlow.flowId,
				status: OpenAiCodexFlowStatus.OPEN_AI_CODEX_FLOW_STATUS_FAILED,
				endedAtMs: Date.now(),
			},
		})
		renderProvider()
		fireEvent.click(await screen.findByRole("button", { name: "开始 OAUTH 认证" }))
		const input = await screen.findByRole("textbox", { name: "完整回调 URI" })
		fireEvent.change(input, { target: { value: "http://localhost:1455/auth/callback?code=denied&state=state" } })
		fireEvent.click(screen.getByRole("button", { name: "完成认证" }))

		expect(await screen.findByText("本次 OAUTH 认证已失败，请重新认证。")).toBeInTheDocument()
		expect(screen.queryByLabelText("OpenAI Codex 认证 URI")).not.toBeInTheDocument()
		expect(screen.getByRole("button", { name: "重新认证" })).toBeInTheDocument()
	})

	it("never renders raw start or import error payloads", async () => {
		const secret = "access_token=secret-token&code=secret-code"
		mocks.signIn.mockRejectedValue(new Error(secret))
		renderProvider()
		fireEvent.click(await screen.findByRole("button", { name: "开始 OAUTH 认证" }))
		await screen.findByText("无法启动 OpenAI Codex OAUTH 认证，请重试。")
		expect(document.body.textContent).not.toContain(secret)
	})
})
