import { PromptProfile } from "@core/prompts/profiles/types"
import type { SystemPromptContext } from "@core/prompts/system-prompt"
import type { FrozenSystemPromptCache } from "@core/storage/task-context-types"
import { ServerTool } from "@shared/proto/dline/models/metadata"
import { createTaskCapabilityToggles } from "@shared/TaskCapabilityToggles"
import { describe, expect, it } from "vitest"
import { HOSTED_WEB_SEARCH_ROUTING_PLAN, LOCAL_WEB_SEARCH_ROUTING_PLAN } from "../../__tests__/web-search-routing-fixtures"
import { resolveFrozenPromptRuntime } from "../FrozenPromptRuntime"

function buildContext(overrides: Partial<SystemPromptContext> = {}): SystemPromptContext {
	return {
		promptProfile: PromptProfile.Standard,
		providerInfo: {
			providerId: "test-provider",
			model: { id: "test-model", info: { id: "test-model" } },
			mode: "act",
		},
		ide: "vscode",
		clineWebToolsEnabled: false,
		webSearchRoutingPlan: LOCAL_WEB_SEARCH_ROUTING_PLAN,
		focusChainSettings: { enabled: false, remindClineInterval: 6 },
		subagentsEnabled: false,
		taskCapabilityToggles: createTaskCapabilityToggles({ mcpServers: { live: false } }),
		supportsBrowserUse: false,
		browserSettings: { viewport: { width: 320, height: 200 }, disableToolUse: true },
		...overrides,
	}
}

function buildFrozen(overrides: Partial<FrozenSystemPromptCache> = {}): FrozenSystemPromptCache {
	return {
		text: "frozen prompt",
		tools: null,
		capabilitiesHash: "sha256:test",
		createdAt: 1,
		refreshedAt: 1,
		refreshReason: "task_start",
		promptBuilder: {
			contractVersion: 3,
			providerId: "test-provider",
			modelId: "test-model",
			profile: "standard",
			nativeTools: false,
		},
		...overrides,
	}
}

describe("resolveFrozenPromptRuntime", () => {
	it("uses the complete persisted runtime instead of changed live settings", () => {
		const frozenToggles = createTaskCapabilityToggles({
			localSkillsToggles: { "skill.md": true },
			mcpServers: { frozen: true },
		})
		const runtime = resolveFrozenPromptRuntime(
			buildFrozen({
				runtime: {
					parallelToolsEnabled: true,
					webToolsEnabled: true,
					webSearchMode: HOSTED_WEB_SEARCH_ROUTING_PLAN.mode,
					webSearchRoute: "hosted",
					webSearchLocalFallbackAvailable: true,
					serverTools: [ServerTool.WEB_SEARCH],
					focusChainEnabled: true,
					subagentsEnabled: true,
					capabilityToggles: frozenToggles,
					browserEnabled: true,
					browserViewport: { width: 1280, height: 800 },
				},
			}),
			buildContext(),
		)

		expect(runtime).toMatchObject({
			parallelToolsEnabled: true,
			webToolsEnabled: true,
			webSearchLocalFallbackAvailable: true,
			focusChainEnabled: true,
			subagentsEnabled: true,
			browserEnabled: true,
			browserViewport: { width: 1280, height: 800 },
		})
		expect(runtime.webSearchRoutingPlan).toMatchObject({
			mode: HOSTED_WEB_SEARCH_ROUTING_PLAN.mode,
			route: "hosted",
			localToolEnabled: false,
			localFallbackAvailable: true,
			serverTools: [ServerTool.WEB_SEARCH],
		})
		expect(runtime.capabilityToggles).toEqual(frozenToggles)
	})

	it("recovers older caches from frozen builder metadata and freshness baseline", () => {
		const legacyToggles = createTaskCapabilityToggles({ mcpServers: { legacy: true } })
		const runtime = resolveFrozenPromptRuntime(
			buildFrozen({
				promptBuilder: {
					contractVersion: 3,
					providerId: "test-provider",
					modelId: "test-model",
					profile: "standard",
					nativeTools: false,
					webToolsEnabled: true,
					webSearchMode: HOSTED_WEB_SEARCH_ROUTING_PLAN.mode,
					webSearchRoute: "hosted",
					webSearchLocalFallbackAvailable: true,
					serverTools: [ServerTool.WEB_SEARCH],
					focusChainEnabled: true,
					subagentsEnabled: true,
				},
				freshnessBaseline: {
					schemaVersion: 3,
					providerId: "test-provider",
					modelId: "test-model",
					promptProfile: "standard",
					transport: "xml",
					parallelToolsEnabled: false,
					imageGenerationAvailable: false,
					imageModelId: "",
					browserEnabled: true,
					browserViewport: "900x600",
					webToolsEnabled: true,
					webSearchRoute: "hosted",
					focusChainEnabled: true,
					rulesHash: "sha256:rules",
					subagentsEnabled: true,
					capabilityHashes: {
						mcp: "sha256:mcp",
						skills: "sha256:skills",
						workflows: "sha256:workflows",
						subagents: "sha256:subagents",
					},
				},
			}),
			buildContext({ taskCapabilityToggles: legacyToggles }),
		)

		expect(runtime.parallelToolsEnabled).toBe(false)
		expect(runtime.webSearchRoutingPlan).toMatchObject({ route: "hosted", serverTools: [ServerTool.WEB_SEARCH] })
		expect(runtime.focusChainEnabled).toBe(true)
		expect(runtime.subagentsEnabled).toBe(true)
		expect(runtime.capabilityToggles).toEqual(legacyToggles)
		expect(runtime.browserEnabled).toBe(true)
		expect(runtime.browserViewport).toEqual({ width: 900, height: 600 })
	})
})
