import type { ApiProfile } from "@shared/proto/dline/profile"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createUnavailableApiHandler, resolveTaskApiProfile } from "../ApiProfileRecovery"

const { profiles } = vi.hoisted(() => ({ profiles: [] as ApiProfile[] }))

vi.mock("@core/controller/file/getApiProfiles", () => ({
	findEnabledProfileByName: (name?: string) => profiles.find((profile) => profile.name === name && profile.enabled),
	readApiProfiles: () => profiles,
}))

describe("resolveTaskApiProfile", () => {
	beforeEach(() => {
		profiles.length = 0
	})

	it("keeps an available task profile", () => {
		profiles.push({ name: "task-profile", provider: "anthropic", enabled: true } as ApiProfile)

		const result = resolveTaskApiProfile({ actModeProfile: "task-profile" }, "act", "anthropic")

		expect(result).toMatchObject({ requestedProfile: "task-profile", resolvedProfile: "task-profile", usedFallback: false })
		expect(result.configuration.actModeProfile).toBe("task-profile")
	})

	it("uses an enabled same-provider fallback without mutating the persisted configuration", () => {
		profiles.push(
			{ name: "other-provider", provider: "openrouter", enabled: true } as ApiProfile,
			{ name: "replacement", provider: "anthropic", enabled: true } as ApiProfile,
		)
		const persisted = { actModeProfile: "deleted-profile" }

		const result = resolveTaskApiProfile(persisted, "act", "anthropic")

		expect(result).toMatchObject({
			requestedProfile: "deleted-profile",
			resolvedProfile: "replacement",
			usedFallback: true,
		})
		expect(result.configuration.actModeProfile).toBe("replacement")
		expect(persisted.actModeProfile).toBe("deleted-profile")
	})

	it("keeps history construction non-throwing when no enabled profile exists", async () => {
		const result = resolveTaskApiProfile({ planModeProfile: "deleted-profile" }, "plan", "anthropic")

		expect(result.error).toBe('Task API profile "deleted-profile" is unavailable and no enabled fallback profile exists.')
		const handler = createUnavailableApiHandler(result.error as string)
		expect(handler.getModel().id).toBe("unavailable")
		await expect(handler.createMessage("", []).next()).rejects.toThrow(result.error)
	})
})
