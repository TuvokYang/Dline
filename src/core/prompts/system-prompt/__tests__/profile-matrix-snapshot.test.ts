import * as fs from "node:fs/promises"
import * as path from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { LOCAL_WEB_SEARCH_ROUTING_PLAN } from "../../__tests__/web-search-routing-fixtures"
import { renderCapabilitiesSection } from "../../capabilities/CapabilitiesSection"
import { SystemPromptGenerator } from "../../generators/SystemPromptGenerator"
import { PromptProfile } from "../../profiles/types"
import type { SystemPromptContext } from "../context"
import {
	PROFILE_SNAPSHOT_CASES,
	profileSnapshotName,
	SNAPSHOT_PROFILES,
	SNAPSHOT_TRANSPORTS,
	type SnapshotProfile,
	type SnapshotTransport,
} from "./profile-snapshot-cases"

const UPDATE_NEW_SNAPSHOTS = process.env.UPDATE_NEW_PROMPT_SNAPSHOTS === "true"
const SNAPSHOTS_ROOT = path.join(__dirname, "__snapshots__")
const SNAPSHOTS_DIR = path.join(SNAPSHOTS_ROOT, "profiles")

const BASE_CONTEXT = {
	cwd: "/workspace/project",
	ide: "Test IDE",
	providerInfo: {
		providerId: "cline",
		model: { id: "explicit-profile-snapshot", info: { id: "explicit-profile-snapshot", capabilities: {} } },
		mode: "act",
	},
	supportsBrowserUse: true,
	browserSettings: { viewport: { width: 1280, height: 800 }, disableToolUse: false },
	mcpHub: {
		getServers: () => [
			{
				uid: "snapshot-mcp",
				name: "Snapshot MCP",
				config: "{}",
				status: "connected" as const,
				tools: [
					{
						name: "echo",
						description: "Returns the complete provided text.",
						inputSchema: {
							type: "object",
							properties: { text: { type: "string" } },
							required: ["text"],
						},
					},
				],
			},
		],
	},
	skills: [
		{ name: "review", description: "Review complete Prompt differences.", path: "/skills/review.md", source: "project" },
	],
	focusChainSettings: { enabled: true, remindClineInterval: 6 },
	globalClineRulesFileInstructions: "Global project rules.",
	localClineRulesFileInstructions: "Local Dline rules.",
	localCursorRulesFileInstructions: "Local Cursor rules.",
	localAgentsRulesFileInstructions: "Local agent rules.",
	preferredLanguageInstructions: "Preferred language: zh-CN.",
	subagentsEnabled: true,
	clineWebToolsEnabled: true,
	webSearchRoutingPlan: LOCAL_WEB_SEARCH_ROUTING_PLAN,
	enableParallelToolCalling: true,
	yoloModeToggled: false,
	isCliEnvironment: false,
	isTesting: true,
} as SystemPromptContext

async function assertCompleteSnapshot(name: string, content: string): Promise<void> {
	const snapshotPath = path.join(SNAPSHOTS_DIR, name)
	if (UPDATE_NEW_SNAPSHOTS) {
		await fs.writeFile(snapshotPath, content, "utf-8")
		return
	}
	expect(await fs.readFile(snapshotPath, "utf-8")).toBe(content)
}

function createContext(
	profile: SnapshotProfile,
	transport: SnapshotTransport,
	overrides: Partial<SystemPromptContext>,
): SystemPromptContext {
	const context = {
		...BASE_CONTEXT,
		...overrides,
		promptProfile: profile === "lite" ? PromptProfile.Lite : PromptProfile.Standard,
		providerInfo: {
			...BASE_CONTEXT.providerInfo,
			...overrides.providerInfo,
		},
		enableNativeToolCalls: transport === "native",
	} as SystemPromptContext
	const capabilities = {
		mcp:
			context.mcpHub?.getServers().some((server) => server.status === "connected" && server.disabled !== true) === true
				? [{ name: "Snapshot MCP.echo", description: "Returns the complete provided text." }]
				: [],
		skills: [{ name: "review", description: "Review complete Prompt differences." }],
		workflows: [{ name: "release", description: "Run the release workflow." }],
		subagents: context.subagentsEnabled === true ? [{ name: "reviewer", description: "Review implementation changes." }] : [],
	}
	return {
		...context,
		capabilities,
		capabilitiesSection: renderCapabilitiesSection(capabilities),
	}
}

function serializeTools(tools: Awaited<ReturnType<SystemPromptGenerator["generate"]>>["tools"]): string {
	return `${JSON.stringify(tools ?? [], null, 2)}\n`
}

function expectedSnapshotNames(): readonly string[] {
	return SNAPSHOT_PROFILES.flatMap((profile) =>
		SNAPSHOT_TRANSPORTS.flatMap((transport) =>
			PROFILE_SNAPSHOT_CASES.flatMap((snapshotCase) => [
				profileSnapshotName(profile, transport, snapshotCase.id, "prompt"),
				...(transport === "native" ? [profileSnapshotName(profile, transport, snapshotCase.id, "tools")] : []),
			]),
		),
	).sort()
}

describe("complete explicit-profile snapshot matrix", () => {
	beforeAll(async () => {
		await fs.mkdir(SNAPSHOTS_DIR, { recursive: true })
		const expectedNames = expectedSnapshotNames()
		const actualNames = (await fs.readdir(SNAPSHOTS_DIR, { withFileTypes: true }))
			.filter((entry) => entry.isFile() && entry.name.endsWith(".snap"))
			.map((entry) => entry.name)
		if (UPDATE_NEW_SNAPSHOTS) {
			await Promise.all(
				actualNames
					.filter((name) => !expectedNames.includes(name))
					.map((name) => fs.unlink(path.join(SNAPSHOTS_DIR, name))),
			)
		}
	})

	afterAll(async () => {
		const generatedNames = (await fs.readdir(SNAPSHOTS_DIR, { withFileTypes: true }))
			.filter((entry) => entry.isFile() && entry.name.endsWith(".snap"))
			.map((entry) => entry.name)
			.sort()
		expect(generatedNames).toEqual(expectedSnapshotNames())
		expect(generatedNames).toHaveLength(54)
	})

	for (const profile of SNAPSHOT_PROFILES) {
		for (const transport of SNAPSHOT_TRANSPORTS) {
			for (const snapshotCase of PROFILE_SNAPSHOT_CASES) {
				it(`${profile}/${transport}/${snapshotCase.id}`, async () => {
					const generated = await new SystemPromptGenerator().generate(
						createContext(profile, transport, snapshotCase.overrides),
					)

					expect(generated.profile).toBe(profile)
					expect(generated.warnings).toEqual([])
					expect(generated.systemPrompt).not.toContain("\n====\n")
					expect(generated.systemPrompt).toContain(profile === "standard" ? "# TOOL USE" : "# TOOLS")
					expect(generated.systemPrompt.match(/^## Explicit Instructions$/gm)).toHaveLength(1)
					expect(generated.systemPrompt.match(/^# ACT MODE V\.S\. PLAN MODE(?: \(STRICT\))?$/gm)).toHaveLength(1)
					expect(generated.systemPrompt).toContain("# CAPABILITIES")
					expect(generated.systemPrompt).not.toMatch(/^# SKILLS$/gm)
					expect(generated.systemPrompt).toContain("# USER'S CUSTOM INSTRUCTIONS")
					expect(generated.systemPrompt).toContain("## Workflows\n")
					expect(generated.systemPrompt).toContain(
						"Workflows provide reusable, ordered procedures for multi-step operations",
					)
					expect(generated.systemPrompt).toContain("The Workflows available to the current task are listed below:")
					expect(generated.systemPrompt).toContain("- `release`: Run the release workflow.")
					expect(
						generated.systemPrompt.indexOf("The Workflows available to the current task are listed below:"),
					).toBeLessThan(generated.systemPrompt.indexOf("- `release`: Run the release workflow."))
					if (profile === "standard") {
						expect(generated.systemPrompt.match(/^## Skills$/gm)).toHaveLength(1)
						expect(generated.systemPrompt).toContain(
							"Skills provide task-specific methods, constraints, and best practices",
						)
						expect(generated.systemPrompt).toContain("The Skills available to the current task are listed below:")
						expect(generated.systemPrompt).toContain("Use `load_skill` once")
						expect(generated.systemPrompt).toContain("Use `load_workflow` once")
						expect(generated.systemPrompt).not.toContain("use_skill")
					} else {
						expect(generated.systemPrompt).not.toMatch(/^## Skills$/gm)
						expect(generated.systemPrompt).not.toContain("load_skill")
						expect(generated.systemPrompt).not.toContain("load_workflow")
					}
					if (snapshotCase.id === "no-mcp") {
						expect(generated.systemPrompt).not.toContain("## MCP")
					} else {
						expect(generated.systemPrompt).toContain("## MCP\n")
						expect(generated.systemPrompt).toContain("MCP tools connect Dline to external services")
						const mcpListIntroduction =
							profile === "standard"
								? "The MCP tools available to the current task are listed below:"
								: "The connected MCP tools known to the current task are listed below:"
						expect(generated.systemPrompt).toContain(mcpListIntroduction)
						expect(generated.systemPrompt).toContain("- `Snapshot MCP.echo`: Returns the complete provided text.")
						expect(generated.systemPrompt.indexOf(mcpListIntroduction)).toBeLessThan(
							generated.systemPrompt.indexOf("- `Snapshot MCP.echo`: Returns the complete provided text."),
						)
						if (profile === "standard") {
							expect(generated.systemPrompt).toContain("Use `load_mcp` to inspect")
						} else {
							expect(generated.systemPrompt).not.toContain("`load_mcp`")
							expect(generated.systemPrompt).not.toContain("`use_mcp_tool`")
						}
					}
					if (profile === "lite" || snapshotCase.id === "no-subagents") {
						expect(generated.systemPrompt).not.toContain("## Subagents")
					} else {
						expect(generated.systemPrompt).toContain("## Subagents\n")
						expect(generated.systemPrompt).toContain("Subagents delegate self-contained research or analysis")
						expect(generated.systemPrompt).toContain("Use `use_subagents` for one to five parallel default subtasks.")
						expect(generated.systemPrompt).toContain("The Subagents available to the current task are listed below:")
						expect(generated.systemPrompt).toContain("- `reviewer`: Review implementation changes.")
					}
					expect(generated.systemPrompt).toContain("Local Dline rules.")
					expect(generated.systemPrompt).toContain("Local Cursor rules.")
					expect(generated.systemPrompt).toContain("Local agent rules.")
					if (transport === "xml" && profile !== "lite") {
						expect(generated.systemPrompt).toContain("## spawn_task")
						expect(generated.systemPrompt).toContain("<spawn_task>")
					}
					if (profile === "lite") {
						for (const toolName of [
							"spawn_task",
							"use_subagent",
							"use_subagents",
							"find_references",
							"rename",
							"replace_text",
							"browser_action",
							"web_fetch",
							"web_search",
						]) {
							expect(generated.systemPrompt).not.toContain(toolName)
							expect(serializeTools(generated.tools)).not.toContain(`"${toolName}"`)
						}
					} else if (transport === "native") {
						const tools = serializeTools(generated.tools)
						expect(tools).toContain('"spawn_task"')
						if (snapshotCase.id === "no-subagents") {
							expect(tools).not.toContain('"use_subagent"')
							expect(tools).not.toContain('"use_subagents"')
						} else {
							expect(tools).toContain('"use_subagent"')
							expect(tools).toContain('"use_subagents"')
						}
					}
					await assertCompleteSnapshot(
						profileSnapshotName(profile, transport, snapshotCase.id, "prompt"),
						generated.systemPrompt,
					)
					if (transport === "native") {
						await assertCompleteSnapshot(
							profileSnapshotName(profile, transport, snapshotCase.id, "tools"),
							serializeTools(generated.tools),
						)
					}
				})
			}
		}
	}
})
