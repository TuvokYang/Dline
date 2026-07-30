import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { StateManager } from "@core/storage/StateManager"
import { resetAllStores } from "@core/storage/secrets"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { type OpenAiCodexCredentials, OpenAiCodexOAuthManager } from "./oauth"

const credentials: OpenAiCodexCredentials = {
	type: "openai-codex",
	access_token: "codex-access-token",
	refresh_token: "codex-refresh-token",
	expires: 1_900_000_000_000,
	email: "codex@example.test",
	accountId: "account-123",
}

describe("OpenAI Codex OAuth credential storage", () => {
	let tempDir: string

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dline-codex-auth-"))
		vi.stubEnv("DLINE_DIR", tempDir)
		resetAllStores()
	})

	afterEach(async () => {
		vi.restoreAllMocks()
		vi.unstubAllEnvs()
		resetAllStores()
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("stores fields under secrets without creating the legacy secrets.json blob", async () => {
		const manager = new OpenAiCodexOAuthManager()
		await manager.saveCredentials(credentials)

		const authPath = path.join(tempDir, "data", "secrets", "openai_codex_oauth.json")
		expect(JSON.parse(await fs.readFile(authPath, "utf8"))).to.deep.equal(credentials)
		await expect(fs.access(path.join(tempDir, "data", "secrets.json"))).rejects.toMatchObject({ code: "ENOENT" })

		const restored = await new OpenAiCodexOAuthManager().loadCredentials()
		expect(restored).to.deep.equal(credentials)
	})

	it("migrates the legacy credentials blob and clears its old key", async () => {
		const setSecret = vi.fn()
		const flushPendingState = vi.fn().mockResolvedValue(undefined)
		vi.spyOn(StateManager, "get").mockReturnValue({
			getSecretKey: vi.fn().mockReturnValue(JSON.stringify(credentials)),
			setSecret,
			flushPendingState,
		} as unknown as StateManager)

		const restored = await new OpenAiCodexOAuthManager().loadCredentials()

		expect(restored).to.deep.equal(credentials)
		expect(setSecret).toHaveBeenCalledWith("openai-codex-oauth-credentials", undefined)
		expect(flushPendingState).toHaveBeenCalledOnce()
		const authPath = path.join(tempDir, "data", "secrets", "openai_codex_oauth.json")
		expect(JSON.parse(await fs.readFile(authPath, "utf8"))).to.deep.equal(credentials)
	})
})
