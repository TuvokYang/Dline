import { OpenAiCodexAuthStatus } from "@shared/proto/dline/account"
import { ApiProfile } from "@shared/proto/dline/profile"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { OpenAiCodexProvider } from "./OpenAiCodexProvider"

const mocks = vi.hoisted(() => ({
	getStatus: vi.fn(),
	signIn: vi.fn(),
	complete: vi.fn(),
	cancel: vi.fn(),
	signOut: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	AccountServiceClient: {
		getOpenAiCodexAuthStatus: mocks.getStatus,
		startOpenAiCodexSignIn: mocks.signIn,
		completeOpenAiCodexCallbackUri: mocks.complete,
		cancelOpenAiCodexSignIn: mocks.cancel,
		signOutOpenAiCodexProfile: mocks.signOut,
	},
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

describe("OpenAiCodexProvider OAuth control", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mocks.getStatus.mockResolvedValue({
			profileId: profile.id,
			status: OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_MISSING,
		})
		mocks.signIn.mockResolvedValue({ profileId: profile.id, flowId: "flow-a" })
		mocks.complete.mockResolvedValue({
			profileId: profile.id,
			status: OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_AUTHENTICATED,
		})
		mocks.cancel.mockResolvedValue({})
		mocks.signOut.mockResolvedValue({})
	})

	it("queries status by stable Profile ID and renders no API key, token or OAuth JSON field", async () => {
		renderProvider()
		await waitFor(() => expect(mocks.getStatus).toHaveBeenCalledWith({ profileId: "profile-a" }))
		expect(screen.getByRole("button", { name: "Sign in with ChatGPT" })).toBeInTheDocument()
		expect(screen.queryByLabelText(/api key/i)).not.toBeInTheDocument()
		expect(screen.queryByLabelText(/access token|refresh token|oauth json/i)).not.toBeInTheDocument()
	})

	it("discovers a pending flow started by another window from the status response", async () => {
		mocks.getStatus.mockResolvedValue({
			profileId: profile.id,
			status: OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_MISSING,
			flowId: "flow-from-other-window",
		})
		renderProvider()

		expect(await screen.findByText("Browser sign-in in progress")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Use callback URI fallback" })).toBeInTheDocument()
	})

	it("starts browser sign-in and reveals the callback URI fallback only for the pending flow", async () => {
		renderProvider()
		fireEvent.click(await screen.findByRole("button", { name: "Sign in with ChatGPT" }))

		await waitFor(() => expect(mocks.signIn).toHaveBeenCalledWith({ profileId: "profile-a" }))
		expect(await screen.findByText("Browser sign-in in progress")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "Use callback URI fallback" })).toBeInTheDocument()
	})

	it("submits the full callback URI with the flow owner and clears it from the DOM immediately", async () => {
		let resolveCompletion!: (value: object) => void
		const completion = new Promise((resolve) => (resolveCompletion = resolve))
		mocks.complete.mockReturnValue(completion)
		renderProvider()
		fireEvent.click(await screen.findByRole("button", { name: "Sign in with ChatGPT" }))
		fireEvent.click(await screen.findByRole("button", { name: "Use callback URI fallback" }))
		const input = screen.getByRole("textbox", { name: "Authorization callback URI" })
		const callbackUri = "http://localhost:1455/auth/callback?code=secret-code&state=secret-state"
		fireEvent.change(input, { target: { value: callbackUri } })
		fireEvent.click(screen.getByRole("button", { name: "Complete sign-in" }))

		expect(mocks.complete).toHaveBeenCalledWith({ profileId: "profile-a", flowId: "flow-a", callbackUri })
		expect(input).toHaveValue("")
		await act(async () => {
			resolveCompletion({
				profileId: profile.id,
				status: OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_AUTHENTICATED,
			})
			await completion
		})
	})

	it("supports target-only cancel, re-auth and sign-out", async () => {
		mocks.getStatus.mockResolvedValue({
			profileId: profile.id,
			status: OpenAiCodexAuthStatus.OPEN_AI_CODEX_AUTH_STATUS_AUTHENTICATED,
		})
		renderProvider()
		fireEvent.click(await screen.findByRole("button", { name: "Sign out" }))
		await waitFor(() => expect(mocks.signOut).toHaveBeenCalledWith({ profileId: "profile-a" }))
	})

	it("never renders raw callback or provider errors", async () => {
		const secret = "access_token=secret-token&code=secret-code"
		mocks.signIn.mockRejectedValue(new Error(secret))
		renderProvider()
		fireEvent.click(await screen.findByRole("button", { name: "Sign in with ChatGPT" }))
		await screen.findByText("Could not start OpenAI Codex sign-in. Please try again.")
		expect(document.body.textContent).not.toContain(secret)
	})
})
