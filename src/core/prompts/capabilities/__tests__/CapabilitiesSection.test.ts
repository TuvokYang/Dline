import { describe, expect, it } from "vitest"
import { renderCapabilitiesSection } from "../CapabilitiesSection"

describe("renderCapabilitiesSection", () => {
	it("renders only capability names and descriptions", () => {
		const rendered = renderCapabilitiesSection({
			mcp: [{ name: "server.tool", description: "Run a tool" }],
			skills: [{ name: "writer", description: "Write text" }],
			workflows: [{ name: "release", description: "Release flow" }],
			subagents: [{ name: "reviewer", description: "Review code" }],
		})

		expect(rendered).toContain("# Capabilities")
		expect(rendered).toContain("`server.tool`: Run a tool")
		expect(rendered).toContain("`writer`: Write text")
		expect(rendered).not.toContain("inputSchema")
		expect(rendered).not.toContain("profile")
		expect(rendered).not.toContain("tools")
		expect(rendered).not.toContain("skills")
		expect(rendered).not.toContain("systemPrompt")
		expect(rendered).not.toContain("path")
		expect(rendered).not.toContain("source")
	})
})
