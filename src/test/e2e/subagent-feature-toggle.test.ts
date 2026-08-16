import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, type Frame, type Page } from "@playwright/test"
import type { MockApiConsumption } from "./fixtures/server"
import { E2ETestHelper, e2e } from "./utils/helpers"

interface StoredSettingsFile {
	subagentsEnabled?: boolean
	values?: {
		subagentsEnabled?: boolean
	}
}

const settingsPath = (dlineDir: string) => path.join(dlineDir, "data", "settings", "settings.json")

async function readSubagentsEnabled(dlineDir: string): Promise<boolean | undefined> {
	const settings = JSON.parse(await readFile(settingsPath(dlineDir), "utf8")) as StoredSettingsFile
	return settings.values?.subagentsEnabled ?? settings.subagentsEnabled
}

async function openFeatureSettings(page: Page, sidebar: Frame): Promise<void> {
	await page.getByRole("button", { name: "Settings", exact: true }).click()
	await expect(sidebar.getByRole("heading", { name: "API Configuration" })).toBeVisible()
	await sidebar.getByTestId("tab-features").click()
	await expect(sidebar.getByRole("heading", { name: "Feature Settings" })).toBeVisible()
}

async function setSubagentsEnabled(page: Page, sidebar: Frame, enabled: boolean): Promise<void> {
	await openFeatureSettings(page, sidebar)
	const subagentsSwitch = sidebar.locator('[id="Subagents"]')
	await expect(subagentsSwitch).toBeVisible()
	if ((await subagentsSwitch.getAttribute("aria-checked")) !== String(enabled)) {
		await subagentsSwitch.click()
	}
	await expect(subagentsSwitch).toHaveAttribute("aria-checked", String(enabled))
	await sidebar.getByRole("button", { name: "Done", exact: true }).click()
	await expect(sidebar.getByTestId("chat-input")).toBeVisible()
}

async function sendTask(sidebar: Frame, text: string): Promise<void> {
	const input = sidebar.getByTestId("chat-input")
	await expect(input).toBeEnabled()
	await input.fill(text)
	await sidebar.getByTestId("send-button").click()
	await expect(sidebar.getByText(text, { exact: true }).first()).toBeVisible()
}

function capabilityRow(sidebar: Frame, name: string) {
	return sidebar.getByText(name, { exact: true }).locator("xpath=ancestor::div[contains(@class, 'mb-2.5')][1]")
}

async function openSubagentCapabilityTab(sidebar: Frame): Promise<void> {
	const openButton = sidebar.getByRole("button", { name: "Show Dline Rules & Workflows", exact: true }).first()
	if (await openButton.isVisible()) await openButton.click()
	await expect(sidebar.getByRole("button", { name: "Hide Dline Rules & Workflows", exact: true }).first()).toBeVisible()
	const tab = sidebar.getByRole("button", { name: "Subagents", exact: true })
	await tab.click()
	await expect(tab).toHaveAttribute("aria-pressed", "true")
}

async function setNamedSubagentToggle(sidebar: Frame, name: string, enabled: boolean): Promise<void> {
	const row = capabilityRow(sidebar, name)
	const toggle = row.getByRole("switch")
	await expect(toggle).toHaveCount(1)
	if ((await toggle.getAttribute("data-state")) !== (enabled ? "checked" : "unchecked")) {
		await toggle.click()
	}
	await expect(toggle).toHaveAttribute("data-state", enabled ? "checked" : "unchecked")
}

async function captureSubagentCapabilityPopup(sidebar: Frame, name: string): Promise<void> {
	const popup = sidebar.getByTestId("capabilities-popup")
	await expect(popup).toBeVisible()
	const screenshotPath = e2e.info().outputPath(name)
	await popup.screenshot({ path: screenshotPath })
	await e2e.info().attach(name, { path: screenshotPath, contentType: "image/png" })
}

function requestToolNames(consumption: MockApiConsumption): string[] {
	const body = consumption.requestBody as {
		tools?: Array<{ name?: string; function?: { name?: string } }>
	}
	return (body.tools ?? [])
		.map((tool) => tool.name ?? tool.function?.name)
		.filter((name): name is string => typeof name === "string")
}

e2e(
	"Subagent feature toggle - enabling inside an active task advertises and executes use_subagent on the next request",
	async ({ dlineDir, helper, page, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		await setSubagentsEnabled(page, sidebar, false)
		await expect.poll(() => readSubagentsEnabled(dlineDir)).toBe(false)

		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_subagent_toggle_ready",
				name: "qna_respond",
				arguments: { response: "E2E_SUBAGENT_TOGGLE_READY" },
			},
			{
				type: "tool",
				id: "call_subagent_after_enable",
				name: "use_subagent",
				arguments: {
					agent_name: "default",
					task: "E2E_SUBAGENT_AFTER_ENABLE_CHILD",
					context: "Return the requested child marker.",
					timeout: 60,
				},
			},
			{
				type: "tool",
				id: "call_subagent_after_enable_child_complete",
				name: "attempt_completion",
				arguments: { result: "E2E_SUBAGENT_AFTER_ENABLE_CHILD_DONE" },
			},
			{
				type: "tool",
				id: "call_subagent_after_enable_parent_complete",
				name: "attempt_completion",
				arguments: { result: "E2E_SUBAGENT_AFTER_ENABLE_DONE" },
				expectedToolResults: [
					{
						callId: "call_subagent_after_enable",
						contentIncludes: "E2E_SUBAGENT_AFTER_ENABLE_CHILD_DONE",
					},
				],
			},
		)

		await sendTask(sidebar, "Create an active task while Subagents are disabled.")
		await expect(sidebar.getByText("E2E_SUBAGENT_TOGGLE_READY", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
		await expect.poll(() => server.getRequestCount("openai-compatible-chat")).toBe(1)
		const disabledRequest = server.getMockConsumptions("openai-compatible-chat")[0]
		expect(requestToolNames(disabledRequest)).not.toContain("use_subagent")
		expect(JSON.stringify(disabledRequest.requestBody)).not.toContain(
			"The Subagents available to the current task are listed below:",
		)
		expect(disabledRequest.contractError).toBeUndefined()

		await setSubagentsEnabled(page, sidebar, true)
		await expect.poll(() => readSubagentsEnabled(dlineDir)).toBe(true)
		await sendTask(sidebar, "Use the default subagent now that the feature is enabled.")

		await expect.poll(() => server.getRequestCount("openai-compatible-chat"), { timeout: 60_000 }).toBe(2)
		const enabledRequest = server.getMockConsumptions("openai-compatible-chat")[1]
		expect(requestToolNames(enabledRequest)).toContain("use_subagent")
		expect(enabledRequest.contractError).toBeUndefined()

		await expect(sidebar.getByText("E2E_SUBAGENT_AFTER_ENABLE_DONE", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect(sidebar.getByText(/Native tool 'use_subagent' was not available/, { exact: false })).toHaveCount(0)
		await expect.poll(() => server.getRequestCount("openai-compatible-chat")).toBe(4)
		const consumptions = server.getMockConsumptions("openai-compatible-chat")
		expect(consumptions[3].contractError).toBeUndefined()
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Named YAML subagent toggle - disabled agents are rejected and re-enabled agents execute in the active task",
	async ({ helper, page, server, sidebar, userDataDir, workspaceDir }) => {
		e2e.setTimeout(240_000)
		await helper.signin(sidebar)
		await setSubagentsEnabled(page, sidebar, true)

		const agentName = "e2e-named-toggle"
		const systemPromptMarker = "E2E_NAMED_TOGGLE_SYSTEM_PROMPT"
		const childDoneMarker = "E2E_NAMED_TOGGLE_CHILD_DONE"
		const namedSubagentDirectory = path.join(workspaceDir, ".agents", "subagents")
		await mkdir(namedSubagentDirectory, { recursive: true })
		await writeFile(
			path.join(namedSubagentDirectory, `${agentName}.yml`),
			`---
name: ${agentName}
description: E2E named subagent toggle
tools:
  - attempt_completion
---

${systemPromptMarker}
Return only the requested result.`,
			"utf8",
		)

		await openSubagentCapabilityTab(sidebar)
		await expect(capabilityRow(sidebar, agentName)).toBeVisible({ timeout: 30_000 })
		await setNamedSubagentToggle(sidebar, agentName, false)
		await captureSubagentCapabilityPopup(sidebar, "named-subagent-disabled.png")
		await sidebar.getByRole("button", { name: "Hide Dline Rules & Workflows", exact: true }).first().click()

		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_named_subagent_disabled",
				name: "use_subagent",
				arguments: {
					agent_name: agentName,
					task: "E2E_NAMED_TOGGLE_DISABLED_TASK",
					context: "The named agent is intentionally disabled.",
					timeout: 60,
				},
			},
			{
				type: "tool",
				id: "call_named_subagent_disabled_parent_complete",
				name: "attempt_completion",
				arguments: { result: "E2E_NAMED_TOGGLE_DISABLED_DONE" },
				expectedToolResults: [
					{
						callId: "call_named_subagent_disabled",
						contentIncludes: `Unknown or disabled subagent '${agentName}'`,
					},
				],
			},
		)

		await sendTask(sidebar, "Try the disabled named subagent and report the rejection.")
		await expect(sidebar.getByText("E2E_NAMED_TOGGLE_DISABLED_DONE", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect.poll(() => server.getRequestCount("openai-compatible-chat")).toBe(2)
		expect(server.getMockConsumptions("openai-compatible-chat")[0].contractError).toBeUndefined()
		expect(server.getMockConsumptions("openai-compatible-chat")[1].contractError).toBeUndefined()

		await openSubagentCapabilityTab(sidebar)
		await setNamedSubagentToggle(sidebar, agentName, true)
		await captureSubagentCapabilityPopup(sidebar, "named-subagent-enabled.png")
		await sidebar.getByRole("button", { name: "Hide Dline Rules & Workflows", exact: true }).first().click()

		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_named_subagent_enabled",
				name: "use_subagent",
				arguments: {
					agent_name: agentName,
					task: "E2E_NAMED_TOGGLE_ENABLED_TASK",
					context: "Return the named agent marker.",
					timeout: 60,
				},
			},
			{
				type: "tool",
				id: "call_named_subagent_enabled_child_complete",
				name: "attempt_completion",
				arguments: { result: childDoneMarker },
				expectedRequestIncludes: [systemPromptMarker],
			},
			{
				type: "tool",
				id: "call_named_subagent_enabled_parent_complete",
				name: "attempt_completion",
				arguments: { result: "E2E_NAMED_TOGGLE_ENABLED_DONE" },
				expectedToolResults: [{ callId: "call_named_subagent_enabled", contentIncludes: childDoneMarker }],
			},
		)

		await sendTask(sidebar, "Run the named subagent after enabling it in this active task.")
		await expect(sidebar.getByText("E2E_NAMED_TOGGLE_ENABLED_DONE", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect.poll(() => server.getRequestCount("openai-compatible-chat")).toBe(5)
		const consumptions = server.getMockConsumptions("openai-compatible-chat")
		expect(consumptions[3].contractError).toBeUndefined()
		expect(JSON.stringify(consumptions[3].requestBody)).toContain(systemPromptMarker)
		expect(consumptions[4].contractError).toBeUndefined()
		await expect(sidebar.getByText(/Native tool 'use_subagent' was not available/, { exact: false })).toHaveCount(0)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)
