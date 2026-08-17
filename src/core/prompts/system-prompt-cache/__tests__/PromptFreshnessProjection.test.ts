import { PromptProfile } from "@core/prompts/profiles/types"
import type { SystemPromptContext } from "@core/prompts/system-prompt"
import { describe, expect, it } from "vitest"
import { buildPromptFreshnessBaseline, comparePromptFreshness, settingsAffectPromptFreshness } from "../PromptFreshnessProjection"

const BASE_CONTEXT = {
	promptProfile: PromptProfile.Standard,
	providerInfo: {
		providerId: "openai",
		model: { id: "dline-test-model", info: { id: "dline-test-model" } },
		mode: "act",
	},
	ide: "vscode",
	supportsBrowserUse: true,
	browserSettings: {
		viewport: { width: 900, height: 600 },
		disableToolUse: false,
	},
	focusChainSettings: { enabled: false, remindClineInterval: 6 },
	subagentsEnabled: true,
	clineWebToolsEnabled: false,
	enableNativeToolCalls: true,
	enableParallelToolCalling: false,
	terminalExecutionMode: "vscodeTerminal",
	defaultTerminalProfile: "default",
	terminalCommandTimeoutSeconds: 1_800,
} satisfies SystemPromptContext

const CAPABILITIES = {
	mcp: [{ name: "filesystem.read", description: "Read files" }],
	skills: [{ name: "review", description: "Review changes" }],
	workflows: [{ name: "release", description: "Prepare a release" }],
	subagents: [{ name: "reviewer", description: "Review code" }],
}

describe("PromptFreshnessProjection", () => {
	it("reports fresh when the current projection matches the frozen baseline", () => {
		const baseline = buildPromptFreshnessBaseline(BASE_CONTEXT, CAPABILITIES)

		expect(comparePromptFreshness(baseline, baseline, { checkedAt: 20, frozenAt: 10 })).toEqual({
			status: "fresh",
			changes: [],
			checkedAt: 20,
			frozenAt: 10,
		})
	})

	it("reports a prompt-safe Subagents summary when the visible catalog changes", () => {
		const frozen = buildPromptFreshnessBaseline(BASE_CONTEXT, CAPABILITIES)
		const current = buildPromptFreshnessBaseline(BASE_CONTEXT, {
			...CAPABILITIES,
			subagents: [{ name: "secret-project-reviewer", description: "Updated private review policy" }],
		})

		const snapshot = comparePromptFreshness(frozen, current, { checkedAt: 20, frozenAt: 10 })

		expect(snapshot).toEqual({
			status: "stale",
			changes: [{ kind: "subagents", summary: "Subagents changed" }],
			checkedAt: 20,
			frozenAt: 10,
		})
		expect(JSON.stringify(snapshot)).not.toContain("secret-project-reviewer")
		expect(JSON.stringify(snapshot)).not.toContain("private review policy")
	})

	it("ignores Skills and Subagents that are not visible in the Lite prompt", () => {
		const liteContext = { ...BASE_CONTEXT, promptProfile: PromptProfile.Lite }
		const frozen = buildPromptFreshnessBaseline(liteContext, CAPABILITIES)
		const current = buildPromptFreshnessBaseline(liteContext, {
			...CAPABILITIES,
			skills: [{ name: "another-skill", description: "Changed" }],
			subagents: [{ name: "another-agent", description: "Changed" }],
		})

		expect(comparePromptFreshness(frozen, current, { checkedAt: 20, frozenAt: 10 }).status).toBe("fresh")
	})

	it("returns unknown for a legacy frozen cache without a baseline", () => {
		const current = buildPromptFreshnessBaseline(BASE_CONTEXT, CAPABILITIES)

		expect(comparePromptFreshness(undefined, current, { checkedAt: 20, frozenAt: 10 })).toEqual({
			status: "unknown",
			changes: [],
			checkedAt: 20,
			frozenAt: 10,
		})
	})

	it("classifies only committed Settings keys represented by the freshness projection", () => {
		expect(settingsAffectPromptFreshness(["subagentsEnabled"])).toBe(true)
		expect(settingsAffectPromptFreshness(["browserSettings", "chatInputSendShortcut"])).toBe(true)
		expect(settingsAffectPromptFreshness(["chatInputSendShortcut", "terminalOutputLineLimit"])).toBe(false)
	})

	it("returns changes in a stable user-facing order", () => {
		const frozen = buildPromptFreshnessBaseline(BASE_CONTEXT, CAPABILITIES)
		const current = buildPromptFreshnessBaseline(
			{
				...BASE_CONTEXT,
				browserSettings: { ...BASE_CONTEXT.browserSettings, viewport: { width: 1280, height: 800 } },
			},
			{ ...CAPABILITIES, mcp: [] },
		)

		expect(comparePromptFreshness(frozen, current, { checkedAt: 20, frozenAt: 10 }).changes).toEqual([
			{ kind: "browser", summary: "Browser settings changed" },
			{ kind: "mcp", summary: "MCP tools changed" },
		])
	})
})
