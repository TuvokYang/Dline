import { describe, expect, it, vi } from "vitest"
import { name, publisher } from "../package.json"

vi.unmock("./registry")

describe("ExtensionRegistryInfo", () => {
	it("derives command and view identifiers from the current distribution package name", async () => {
		const { ExtensionRegistryInfo } = await import("./registry")
		const prefix = `${name}.`

		expect(ExtensionRegistryInfo.id).toBe(`${publisher}.${name}`)
		expect(ExtensionRegistryInfo.views.Sidebar).toBe(`${name}.SidebarProvider`)
		for (const command of Object.values(ExtensionRegistryInfo.commands)) {
			expect(command.startsWith(prefix)).toBe(true)
		}
	})
})
