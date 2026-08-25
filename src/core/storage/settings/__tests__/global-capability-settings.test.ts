import type { StateManager } from "@core/storage/StateManager"
import { describe, expect, it, vi } from "vitest"
import { reconcileGlobalCapabilities, removeGlobalCapability } from "../global-capability-settings"

describe("global capability settings", () => {
	it("preserves canonical choices across temporary empty discovery while explicit removal still deletes", async () => {
		let stored: Record<string, boolean> = { "/rules/persisted.md": false }
		const stateManager = {
			mutateGlobalSettingsKey: vi.fn(
				async (_key, mutate: (current: Record<string, boolean>) => Record<string, boolean>) => {
					stored = mutate(stored)
					return stored
				},
			),
		} as unknown as StateManager

		await reconcileGlobalCapabilities(stateManager, "globalClineRulesToggles", {})
		expect(stored).toEqual({ "/rules/persisted.md": false })

		await reconcileGlobalCapabilities(stateManager, "globalClineRulesToggles", {
			"/rules/persisted.md": true,
			"/rules/new.md": true,
		})
		expect(stored).toEqual({ "/rules/persisted.md": false, "/rules/new.md": true })

		await removeGlobalCapability(stateManager, "globalClineRulesToggles", "/rules/persisted.md")
		expect(stored).toEqual({ "/rules/new.md": true })
	})
})
