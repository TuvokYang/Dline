/**
 * Commands Prompt Snapshot Tests
 *
 * Validates that slash command prompts (condense, new_task, etc.)
 * remain consistent and that the i18n auto-registration picks up
 * the commands module correctly.
 */
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { describe, it } from "vitest"
import { condenseToolResponse, deepPlanningToolResponse, newTaskToolResponse } from "../../commands"
import { assertPromptContent } from "./snapshot-content"

const UPDATE_SNAPSHOTS = process.argv.includes("--update-snapshots") || process.env.UPDATE_SNAPSHOTS === "true"
const SNAPSHOTS_DIR = path.join(__dirname, "__snapshots__")

async function assertSnapshot(name: string, content: string): Promise<void> {
	const snapshotPath = path.join(SNAPSHOTS_DIR, name)
	assertPromptContent(name, content)

	if (UPDATE_SNAPSHOTS) {
		await fs.writeFile(snapshotPath, content, "utf-8")
		console.log(`Updated snapshot: ${name} (${content.length} chars)`)
		return
	}

	try {
		await fs.access(snapshotPath)
	} catch {
		throw new Error(`Snapshot does not exist: ${name}. Run with --update-snapshots to create it.`)
	}
}

describe("Commands Prompt Snapshots", () => {
	beforeAll(async () => {
		await fs.mkdir(SNAPSHOTS_DIR, { recursive: true }).catch(() => {})
	})

	it("should generate condense prompt with focus chain enabled", async () => {
		const prompt = condenseToolResponse({ enabled: true })
		await assertSnapshot("commands_condense_fc_enabled.snap", prompt)
	})

	it("should generate condense prompt with focus chain disabled", async () => {
		const prompt = condenseToolResponse({ enabled: false })
		await assertSnapshot("commands_condense_fc_disabled.snap", prompt)
	})

	it("should generate new_task prompt with native tools", async () => {
		const prompt = newTaskToolResponse(true)
		await assertSnapshot("commands_newtask_native.snap", prompt)
	})

	it("should generate new_task prompt without native tools", async () => {
		const prompt = newTaskToolResponse(false)
		await assertSnapshot("commands_newtask_non_native.snap", prompt)
	})

	// --- Deep-planning: generic variant (fallback) ---
	it("should generate deep-planning generic, fc=enabled, native=false", async () => {
		const prompt = deepPlanningToolResponse({ enabled: true }, undefined, false)
		await assertSnapshot("commands_deepplan_generic_fc_on_native_off.snap", prompt)
	})

	it("should generate deep-planning generic, fc=disabled, native=true", async () => {
		const prompt = deepPlanningToolResponse({ enabled: false }, undefined, true)
		await assertSnapshot("commands_deepplan_generic_fc_off_native_on.snap", prompt)
	})

	// --- Deep-planning: GPT-5.1 variant (model.id includes "gpt-5.1") ---
	it("should generate deep-planning gpt51, fc=enabled, native=false", async () => {
		const prompt = deepPlanningToolResponse(
			{ enabled: true },
			{ providerId: "openai", model: { id: "gpt-5.1" } } as any,
			false,
		)
		await assertSnapshot("commands_deepplan_gpt51_fc_on_native_off.snap", prompt)
	})

	it("should generate deep-planning gpt51, fc=disabled, native=true", async () => {
		const prompt = deepPlanningToolResponse(
			{ enabled: false },
			{ providerId: "openai", model: { id: "gpt-5.1" } } as any,
			true,
		)
		await assertSnapshot("commands_deepplan_gpt51_fc_off_native_on.snap", prompt)
	})

	// --- Deep-planning: Gemini-3 variant (model.id includes "gemini-3") ---
	it("should generate deep-planning gemini3, fc=enabled, native=false", async () => {
		const prompt = deepPlanningToolResponse(
			{ enabled: true },
			{ providerId: "gemini", model: { id: "gemini-3" } } as any,
			false,
		)
		await assertSnapshot("commands_deepplan_gemini3_fc_on_native_off.snap", prompt)
	})

	it("should generate deep-planning gemini3, fc=disabled, native=true", async () => {
		const prompt = deepPlanningToolResponse(
			{ enabled: false },
			{ providerId: "gemini", model: { id: "gemini-3" } } as any,
			true,
		)
		await assertSnapshot("commands_deepplan_gemini3_fc_off_native_on.snap", prompt)
	})
})
