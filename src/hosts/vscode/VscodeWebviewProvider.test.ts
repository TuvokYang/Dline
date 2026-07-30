import { afterEach, describe, expect, it, vi } from "vitest"
import { WebviewProvider } from "@/core/webview"
import { WebviewProviderRegistry } from "@/core/webview/WebviewProviderRegistry"
import { VscodeWebviewProvider } from "./VscodeWebviewProvider"

vi.mock("@/registry", () => ({
	ExtensionRegistryInfo: { views: { Sidebar: "dline.SidebarProvider" } },
}))

describe("VscodeWebviewProvider registration", () => {
	afterEach(async () => {
		await WebviewProviderRegistry.disposeAll()
	})

	it("registers itself as the sidebar provider", () => {
		const provider = new VscodeWebviewProvider({} as never, { deferController: true })

		expect(WebviewProvider.getInstance()).toBe(provider)
	})
})
