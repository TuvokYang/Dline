import {
	activeCapabilityScope,
	resolveToggle,
	resolveToggles,
	withoutToggleOverride,
	withToggleOverride,
} from "@core/storage/settings/capability-toggle-scopes"
import { describe, expect, it } from "vitest"

describe("capability toggle scopes", () => {
	describe("active scope selection", () => {
		it("falls back to global when no workspace is open", () => {
			expect(activeCapabilityScope({ hasWorkspace: false, hasTask: false })).toBe("global")
		})

		it("selects workspace once a workspace is open but no task was entered", () => {
			expect(activeCapabilityScope({ hasWorkspace: true, hasTask: false })).toBe("workspace")
		})

		it("selects task once a task was entered", () => {
			expect(activeCapabilityScope({ hasWorkspace: true, hasTask: true })).toBe("task")
		})
	})

	describe("resolution", () => {
		it("uses the discovered default when no scope has an opinion", () => {
			expect(resolveToggles({ "/skills/a": true, "/skills/b": false })).toEqual({
				"/skills/a": true,
				"/skills/b": false,
			})
		})

		it("lets workspace override global and task override workspace", () => {
			const discovered = { "/skills/a": true }

			expect(resolveToggles(discovered, { global: { "/skills/a": false } })).toEqual({ "/skills/a": false })
			expect(
				resolveToggles(discovered, {
					global: { "/skills/a": false },
					workspace: { "/skills/a": true },
				}),
			).toEqual({ "/skills/a": true })
			expect(
				resolveToggles(discovered, {
					global: { "/skills/a": false },
					workspace: { "/skills/a": true },
					task: { "/skills/a": false },
				}),
			).toEqual({ "/skills/a": false })
		})

		it("inherits the level above when the nearer scope has no override", () => {
			const discovered = { "/skills/a": true }

			expect(resolveToggles(discovered, { global: { "/skills/a": false }, task: {} })).toEqual({
				"/skills/a": false,
			})
		})

		it("keeps an explicit false instead of treating it as missing", () => {
			expect(resolveToggle("/skills/a", true, { global: { "/skills/a": false } })).toBe(false)
		})

		it("ignores overrides for capabilities that are no longer discovered", () => {
			expect(resolveToggles({ "/skills/a": true }, { global: { "/skills/removed": false } })).toEqual({
				"/skills/a": true,
			})
		})

		it("never mutates the discovered scan result or the scope maps", () => {
			const discovered = { "/skills/a": true }
			const global = { "/skills/a": false }

			resolveToggles(discovered, { global })

			expect(discovered).toEqual({ "/skills/a": true })
			expect(global).toEqual({ "/skills/a": false })
		})
	})

	describe("explicit overrides", () => {
		it("records only the changed path so the rest keeps inheriting", () => {
			expect(withToggleOverride({ "/skills/a": false }, "/skills/b", true)).toEqual({
				"/skills/a": false,
				"/skills/b": true,
			})
			expect(withToggleOverride(undefined, "/skills/b", false)).toEqual({ "/skills/b": false })
		})

		it("drops an override so the capability inherits from the scope above again", () => {
			const remaining = withoutToggleOverride({ "/skills/a": false, "/skills/b": true }, "/skills/a")

			expect(remaining).toEqual({ "/skills/b": true })
			expect(resolveToggle("/skills/a", true, { workspace: remaining })).toBe(true)
		})
	})
})
