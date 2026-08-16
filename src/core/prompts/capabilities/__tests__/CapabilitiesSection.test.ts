import { describe, expect, it } from "vitest"
import { PromptProfile } from "../../profiles/types"
import { renderCapabilitiesForContext, renderCapabilitiesSection } from "../CapabilitiesSection"

describe("renderCapabilitiesSection", () => {
	it("renders purpose, usage, and available entries without internal metadata", () => {
		const rendered = renderCapabilitiesSection(
			{
				mcp: [{ name: "server.tool", description: "Run a tool" }],
				skills: [{ name: "writer", description: "Write text" }],
				workflows: [{ name: "release", description: "Release flow" }],
				subagents: [{ name: "reviewer", description: "Review code" }],
			},
			{ profile: PromptProfile.Standard },
		)

		expect(rendered).toContain("# Capabilities")
		expect(rendered).toContain("MCP tools connect Dline to external services")
		expect(rendered).toContain("Skills provide task-specific methods, constraints, and best practices")
		expect(rendered).toContain("Workflows provide reusable, ordered procedures for multi-step operations")
		expect(rendered).toContain("Subagents delegate self-contained research or analysis")
		expect(rendered).toContain("Use `use_subagent` for one default or named subagent")
		expect(rendered).toContain("Use `use_subagents` for one to five parallel default subtasks")
		expect(rendered).toContain("Use `load_mcp` to inspect")
		expect(rendered).toContain("Use `load_skill` once")
		expect(rendered).toContain("Use `load_workflow` once")
		expect(rendered).toContain('If `<explicit_instructions type="skill">` is already present')
		expect(rendered).toContain('If `<explicit_instructions type="workflow">` is already present')
		expect(rendered).not.toContain("from a slash command")

		const expectedEntries = [
			["The MCP tools available to the current task are listed below:", "`server.tool`: Run a tool"],
			["The Skills available to the current task are listed below:", "`writer`: Write text"],
			["The Workflows available to the current task are listed below:", "`release`: Release flow"],
			["The Subagents available to the current task are listed below:", "`reviewer`: Review code"],
		] as const
		for (const [introduction, entry] of expectedEntries) {
			expect(rendered).toContain(introduction)
			expect(rendered).toContain(entry)
			expect(rendered.indexOf(introduction)).toBeLessThan(rendered.indexOf(entry))
		}
		expect(rendered).not.toContain("load_subagent")
		expect(rendered).not.toContain("inputSchema")
		expect(rendered).not.toContain("profile")
		expect(rendered).not.toContain('"tools"')
		expect(rendered).not.toContain("skills")
		expect(rendered).not.toContain("systemPrompt")
		expect(rendered).not.toContain("path")
		expect(rendered).not.toContain('"source"')
	})

	it("hides subagent guidance when the Standard feature gate is disabled", () => {
		const capabilities = {
			mcp: [],
			skills: [],
			workflows: [],
			subagents: [{ name: "reviewer", description: "Review code" }],
		}

		const disabled = renderCapabilitiesForContext(capabilities, {
			profile: PromptProfile.Standard,
			subagentsEnabled: false,
		})
		const enabled = renderCapabilitiesForContext(capabilities, {
			profile: PromptProfile.Standard,
			subagentsEnabled: true,
		})

		expect(disabled).not.toContain("Subagents delegate self-contained research or analysis")
		expect(disabled).not.toContain("The Subagents available to the current task are listed below:")
		expect(disabled).not.toContain("`reviewer`: Review code")
		expect(enabled).toContain("Subagents delegate self-contained research or analysis")
		expect(enabled).toContain("The Subagents available to the current task are listed below:")
		expect(enabled).toContain("`reviewer`: Review code")
	})

	it("keeps Lite guidance honest without exposing unavailable loaders", () => {
		const rendered = renderCapabilitiesSection(
			{
				mcp: [{ name: "server.tool", description: "Run a tool" }],
				skills: [{ name: "writer", description: "Write text" }],
				workflows: [{ name: "release", description: "Release flow" }],
				subagents: [],
			},
			{ profile: PromptProfile.Lite, exclude: ["skills"] },
		)

		expect(rendered).not.toContain("## Skills")
		expect(rendered).toContain("## MCP")
		expect(rendered).toContain("MCP tools connect Dline to external services")
		expect(rendered).toContain("The connected MCP tools known to the current task are listed below:")
		expect(rendered).not.toContain("`load_mcp`")
		expect(rendered).not.toContain("`use_mcp_tool`")
		expect(rendered).toContain("## Workflows")
		expect(rendered).toContain("Workflows provide reusable, ordered procedures for multi-step operations")
		expect(rendered).toContain("The Workflows available to the current task are listed below:")
		expect(rendered).not.toContain("`load_workflow`")
		expect(rendered).toContain('If `<explicit_instructions type="workflow">` is present')
		expect(rendered).not.toContain("slash command")
	})
})
