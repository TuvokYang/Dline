import fs from "fs"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, it } from "vitest"
import "should"
import { hasClineToDlineMigrationCandidates, migrateFromClineToDline } from "../migration"

describe("Cline to Dline migration", () => {
	let tempDir: string
	let homeDir: string
	let documentsDir: string
	let dlineDocumentsDir: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cline-dline-migration-"))
		homeDir = path.join(tempDir, "home")
		documentsDir = path.join(tempDir, "Documents")
		dlineDocumentsDir = path.join(documentsDir, "Dline")
		fs.mkdirSync(homeDir, { recursive: true })
		fs.mkdirSync(documentsDir, { recursive: true })
	})

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	it("migrates a legacy directory only when the target is empty", async () => {
		const oldDataDir = path.join(homeDir, ".cline", "data")
		const newDataDir = path.join(homeDir, ".dline", "data")
		fs.mkdirSync(oldDataDir, { recursive: true })
		fs.writeFileSync(path.join(oldDataDir, "globalState.json"), JSON.stringify({ mode: "act" }))

		const result = await migrateFromClineToDline({ homeDir, documentsDir, dlineDocumentsDir })

		result.migrated.should.be.true()
		fs.existsSync(path.join(newDataDir, "globalState.json")).should.be.true()

		const secondResult = await migrateFromClineToDline({ homeDir, documentsDir, dlineDocumentsDir })

		secondResult.migrated.should.be.false()
	})

	it("does not migrate a legacy directory into a non-empty target", async () => {
		const oldDataDir = path.join(homeDir, ".cline", "data")
		const newDataDir = path.join(homeDir, ".dline", "data")
		fs.mkdirSync(oldDataDir, { recursive: true })
		fs.writeFileSync(path.join(oldDataDir, "globalState.json"), JSON.stringify({ mode: "act" }))
		fs.mkdirSync(newDataDir, { recursive: true })
		fs.writeFileSync(path.join(newDataDir, "existing.json"), JSON.stringify({ mode: "plan" }))

		const hasCandidates = await hasClineToDlineMigrationCandidates({ homeDir, documentsDir, dlineDocumentsDir })
		const result = await migrateFromClineToDline({ homeDir, documentsDir, dlineDocumentsDir })

		hasCandidates.should.be.false()
		result.migrated.should.be.false()
		fs.existsSync(path.join(newDataDir, "globalState.json")).should.be.false()
	})

	it("does not migrate legacy VSCode task data into an existing Dline tasks directory", async () => {
		const legacyStorageDir = path.join(tempDir, "legacy-storage", "saoudrizwan.claude-dev")
		const legacyTaskHistory = path.join(legacyStorageDir, "state", "taskHistory.json")
		const legacyTaskDir = path.join(legacyStorageDir, "tasks", "task-1")
		const dlineTasksDir = path.join(dlineDocumentsDir, "tasks")

		fs.mkdirSync(path.dirname(legacyTaskHistory), { recursive: true })
		fs.writeFileSync(legacyTaskHistory, JSON.stringify([{ id: "legacy" }]))
		fs.mkdirSync(legacyTaskDir, { recursive: true })
		fs.writeFileSync(path.join(legacyTaskDir, "ui_messages.json"), "[]")
		fs.mkdirSync(dlineTasksDir, { recursive: true })
		fs.writeFileSync(path.join(dlineTasksDir, "existing.json"), "{}")

		const result = await migrateFromClineToDline({
			homeDir,
			documentsDir,
			dlineDocumentsDir,
			legacyVscodeGlobalStoragePaths: [legacyStorageDir],
		})

		result.migrated.should.be.false()
		fs.existsSync(path.join(dlineTasksDir, "taskHistory.json")).should.be.false()
		fs.existsSync(path.join(dlineTasksDir, "task-1")).should.be.false()
	})

	it("migrates legacy VSCode task data when the Dline tasks directory is empty", async () => {
		const legacyStorageDir = path.join(tempDir, "legacy-storage", "saoudrizwan.claude-dev")
		const legacyTaskHistory = path.join(legacyStorageDir, "state", "taskHistory.json")
		const legacyTaskDir = path.join(legacyStorageDir, "tasks", "task-1")
		const dlineTasksDir = path.join(dlineDocumentsDir, "tasks")

		fs.mkdirSync(path.dirname(legacyTaskHistory), { recursive: true })
		fs.writeFileSync(legacyTaskHistory, JSON.stringify([{ id: "legacy" }]))
		fs.mkdirSync(legacyTaskDir, { recursive: true })
		fs.writeFileSync(path.join(legacyTaskDir, "ui_messages.json"), "[]")

		const result = await migrateFromClineToDline({
			homeDir,
			documentsDir,
			dlineDocumentsDir,
			legacyVscodeGlobalStoragePaths: [legacyStorageDir],
		})

		result.migrated.should.be.true()
		fs.existsSync(path.join(dlineTasksDir, "taskHistory.json")).should.be.true()
		fs.existsSync(path.join(dlineTasksDir, "task-1", "ui_messages.json")).should.be.true()
	})

	it("can migrate Documents/Cline and legacy VSCode tasks into separate empty targets", async () => {
		const legacyStorageDir = path.join(tempDir, "legacy-storage", "saoudrizwan.claude-dev")
		const legacyTaskDir = path.join(legacyStorageDir, "tasks", "task-1")
		const oldDocumentsRulesDir = path.join(documentsDir, "Cline", "Rules")

		fs.mkdirSync(oldDocumentsRulesDir, { recursive: true })
		fs.writeFileSync(path.join(oldDocumentsRulesDir, "rule.md"), "legacy rule")
		fs.mkdirSync(legacyTaskDir, { recursive: true })
		fs.writeFileSync(path.join(legacyTaskDir, "ui_messages.json"), "[]")

		const result = await migrateFromClineToDline({
			homeDir,
			documentsDir,
			dlineDocumentsDir,
			legacyVscodeGlobalStoragePaths: [legacyStorageDir],
		})

		result.migrated.should.be.true()
		fs.existsSync(path.join(dlineDocumentsDir, "Rules", "rule.md")).should.be.true()
		fs.existsSync(path.join(dlineDocumentsDir, "tasks", "task-1", "ui_messages.json")).should.be.true()
	})
})
