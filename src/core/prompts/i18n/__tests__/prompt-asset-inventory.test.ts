import * as fs from "node:fs/promises"
import * as path from "node:path"

import { describe, expect, it } from "vitest"

import { RuntimePromptGenerator } from "../../generators/RuntimePromptGenerator"
import { englishPromptGroups, englishPrompts, englishTemplateStore } from "../en"
import commandDeepPlanning5Step from "../en/commands/deep-planning-5-step"
import legacyDeepPlanning5Step from "../en/deepPlanning5Step"

const EXPECTED_NAMESPACES = [
	"accessMcpResource",
	"actModeRespond",
	"actVsPlanMode",
	"agentRole",
	"applyPatch",
	"askFollowupQuestion",
	"attemptCompletion",
	"browserAction",
	"capabilities",
	"capabilityCatalog",
	"commands",
	"contextManagement",
	"deepPlanning5Step",
	"deepPlanningGeneric",
	"editingFiles",
	"executeCommand",
	"feedback",
	"findReferences",
	"focusChain",
	"generateExplanation",
	"generateReport",
	"listCodeDefinitionNames",
	"listFiles",
	"loadCapability",
	"loadMcpDocumentation",
	"loadMcpDocumentationTool",
	"mcp",
	"newTask",
	"objective",
	"planModeRespond",
	"qnaRespond",
	"readFile",
	"rename",
	"replaceInFile",
	"replaceText",
	"responses",
	"resumeProvenance",
	"rules",
	"runtimeEnvironment",
	"searchFiles",
	"skills",
	"spawnTask",
	"statusUpdate",
	"subagent",
	"systemInfo",
	"taskProgress",
	"toolHandlers",
	"toolUseExamples",
	"toolUseFormatting",
	"toolUseGuidelines",
	"toolUseIndex",
	"toolUseTools",
	"useMcpTool",
	"userInstructions",
	"useSkill",
	"variants.lite",
	"variants.native",
	"webFetch",
	"webSearch",
	"writeToFile",
	"xmlProjection",
] as const

const PROMPTS_DIR = path.resolve(__dirname, "../..")

/**
 * Sorts immutable string collections for order-independent inventory assertions.
 *
 * @param values Values to copy and sort.
 * @returns A sorted mutable copy.
 */
function sortValues(values: readonly string[]): string[] {
	return [...values].sort()
}

/**
 * Collects production TypeScript source paths below a prompt directory.
 *
 * @param directory Directory to inspect recursively.
 * @returns Production TypeScript source paths below the directory.
 */
async function collectSources(directory: string): Promise<string[]> {
	const entries = await fs.readdir(directory, { withFileTypes: true })
	const sourcePaths: string[] = []

	for (const entry of entries) {
		if (entry.name === "__tests__") {
			continue
		}

		const entryPath = path.join(directory, entry.name)
		if (entry.isDirectory()) {
			sourcePaths.push(...(await collectSources(entryPath)))
		} else if (entry.isFile() && entry.name.endsWith(".ts")) {
			sourcePaths.push(entryPath)
		}
	}

	return sourcePaths
}

describe("prompt asset inventory", () => {
	it("locks the final English namespace inventory", () => {
		expect(sortValues(Object.keys(englishPrompts))).toEqual(sortValues(EXPECTED_NAMESPACES))
		expect(EXPECTED_NAMESPACES).toHaveLength(61)
	})

	it("locks the static domain group order and coverage", () => {
		expect(englishPromptGroups.map((group) => group.name)).toEqual(["system", "tools", "commands", "variants"])
		expect(englishPromptGroups.map((group) => group.modules.length)).toEqual([23, 33, 3, 2])
		expect(englishPromptGroups.flatMap((group) => group.modules)).toHaveLength(61)
		expect(englishPromptGroups[3].modules.map((module) => module.name)).toEqual(["variants.native", "variants.lite"])
	})

	it("renders declared parameters through the immutable runtime generator", () => {
		const prompt = new RuntimePromptGenerator(englishTemplateStore).generate("toolHandlers.missingToolParameterError", {
			PARAM_NAME: "command",
			TOOL_REMINDER: "Use the tool schema.",
		}).text

		expect(prompt).toContain("command")
		expect(prompt).toContain("Use the tool schema.")
		expect(prompt).not.toContain("[MISSING:")
	})

	it("preserves command prompt content while moving ownership into the commands domain", () => {
		expect(commandDeepPlanning5Step).toEqual(legacyDeepPlanning5Step)
	})

	it("owns command prompt content in the commands domain while preserving legacy entry points", async () => {
		const commandEntries = [
			["commands.ts", "commands.ts"],
			["deep-planning-5-step.ts", "deepPlanning5Step.ts"],
			["deep-planning-generic.ts", "deepPlanningGeneric.ts"],
		] as const

		await Promise.all(
			commandEntries.flatMap(([domainEntry, legacyEntry]) => [
				expect(fs.readFile(path.resolve(__dirname, "../en/commands", domainEntry), "utf-8")).resolves.toContain(
					"const prompts",
				),
				expect(fs.readFile(path.resolve(__dirname, "../en", legacyEntry), "utf-8")).resolves.toContain(
					`export { default } from "./commands/${domainEntry.slice(0, -3)}"`,
				),
			]),
		)
	})

	it("provides system prompt modules from the system domain", async () => {
		const systemEntries = [
			"actVsPlanMode.ts",
			"agentRole.ts",
			"capabilities.ts",
			"contextManagement.ts",
			"editingFiles.ts",
			"feedback.ts",
			"focusChain.ts",
			"mcp.ts",
			"objective.ts",
			"responses.ts",
			"resumeProvenance.ts",
			"rules.ts",
			"skills.ts",
			"systemInfo.ts",
			"taskProgress.ts",
			"toolUseExamples.ts",
			"toolUseFormatting.ts",
			"toolUseGuidelines.ts",
			"toolUseIndex.ts",
			"toolUseTools.ts",
			"userInstructions.ts",
		]

		await Promise.all(
			systemEntries.map((entry) => expect(fs.stat(path.resolve(__dirname, "../en/system", entry))).resolves.toBeDefined()),
		)
	})

	it("owns selected system prompt content in the system domain while preserving legacy entry points", async () => {
		const systemEntries = [
			["feedback.ts", "feedback.ts"],
			["mcp.ts", "mcp.ts"],
			["rules.ts", "rules.ts"],
		] as const

		await Promise.all(
			systemEntries.flatMap(([domainEntry, legacyEntry]) => [
				expect(fs.readFile(path.resolve(__dirname, "../en/system", domainEntry), "utf-8")).resolves.toContain(
					"const prompts",
				),
				expect(fs.readFile(path.resolve(__dirname, "../en", legacyEntry), "utf-8")).resolves.toContain(
					`export { default } from "./system/${domainEntry.slice(0, -3)}"`,
				),
			]),
		)
	})

	it("keeps physical ownership in all four domains", async () => {
		const domainDirectories = ["system", "tools", "commands", "variants"] as const
		const domainSources = (
			await Promise.all(domainDirectories.map((directory) => collectSources(path.resolve(__dirname, "../en", directory))))
		).flat()

		await Promise.all(
			domainSources.map(async (sourcePath) => {
				const source = await fs.readFile(sourcePath, "utf-8")
				expect(source, path.relative(PROMPTS_DIR, sourcePath)).not.toMatch(
					/^export \{ default \} from "\.\.\/[^"]+"\s*$/m,
				)
			}),
		)

		const englishIndex = await fs.readFile(path.resolve(__dirname, "../en/index.ts"), "utf-8")
		const localDomainImports = [...englishIndex.matchAll(/^import .* from "(\.\/[^"]+)"$/gm)].map(
			([, modulePath]) => modulePath,
		)

		expect(localDomainImports).toEqual(["./commands/index", "./system/index", "./tools/index", "./variants/index"])
	})

	it("provides tool prompt modules from the tools domain", async () => {
		const toolEntries = [
			"accessMcpResource.ts",
			"actModeRespond.ts",
			"applyPatch.ts",
			"askFollowupQuestion.ts",
			"attemptCompletion.ts",
			"browserAction.ts",
			"executeCommand.ts",
			"findReferences.ts",
			"generateExplanation.ts",
			"generateReport.ts",
			"listCodeDefinitionNames.ts",
			"listFiles.ts",
			"loadCapability.ts",
			"loadMcpDocumentation.ts",
			"loadMcpDocumentationTool.ts",
			"newTask.ts",
			"planModeRespond.ts",
			"qnaRespond.ts",
			"readFile.ts",
			"rename.ts",
			"replaceInFile.ts",
			"replaceText.ts",
			"searchFiles.ts",
			"spawnTask.ts",
			"statusUpdate.ts",
			"subagent.ts",
			"toolHandlers.ts",
			"useMcpTool.ts",
			"useSkill.ts",
			"webFetch.ts",
			"webSearch.ts",
			"writeToFile.ts",
		]

		await Promise.all(
			toolEntries.map((entry) => expect(fs.stat(path.resolve(__dirname, "../en/tools", entry))).resolves.toBeDefined()),
		)
	})

	it("registers four physical domain entry points", async () => {
		const domainEntries = ["system/index.ts", "tools/index.ts", "commands/index.ts", "variants/index.ts"]

		await Promise.all(
			domainEntries.map((entry) => expect(fs.stat(path.resolve(__dirname, "../en", entry))).resolves.toBeDefined()),
		)
	})
})
