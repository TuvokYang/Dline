import { strict as assert } from "node:assert"
import fs from "fs/promises"
import os from "os"
import * as path from "path"
import { afterEach, describe, it } from "vitest"
import { ClineDefaultTool, getToolUseNames } from "@/shared/tools"
import {
	AGENTS_CONFIG_DIRECTORY_NAME,
	AgentConfigLoader,
	parseAgentConfigFromYaml,
	readAgentConfigsFromDisk,
} from "../AgentConfigLoader"

async function createTempHomeDir(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), "agent-config-loader-"))
}

describe("AgentConfigLoader", () => {
	const tempDirs: string[] = []

	afterEach(async () => {
		await AgentConfigLoader.resetInstanceForTests()
		await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
		tempDirs.length = 0
	})

	it("parses a profile frontmatter config and system prompt body", () => {
		const content = `---
name: code-reviewer
description: Reviews code for quality and best practices
tools: read_file, list_files, search_files
profile: subagent-reviewer
---

You are a code reviewer.`

		const parsed = parseAgentConfigFromYaml(content)

		assert.equal(parsed.name, "code-reviewer")
		assert.equal(parsed.description, "Reviews code for quality and best practices")
		assert.equal((parsed as { profile?: string }).profile, "subagent-reviewer")
		assert.equal("modelId" in parsed, false)
		assert.deepEqual(parsed.tools, [ClineDefaultTool.FILE_READ, ClineDefaultTool.LIST_FILES, ClineDefaultTool.SEARCH])
		assert.equal(parsed.systemPrompt, "You are a code reviewer.")
	})

	it("supports raw Cline tool ids in tools", () => {
		const content = `---
name: cli-agent
description: Uses internal ids
tools:
  - read_file
  - list_files
profile: cli-profile
---

Prompt body`

		const parsed = parseAgentConfigFromYaml(content)
		assert.deepEqual(parsed.tools, [ClineDefaultTool.FILE_READ, ClineDefaultTool.LIST_FILES])
	})

	it("ignores deprecated modelId frontmatter", () => {
		const content = `---
name: legacy-agent
description: legacy
modelId: old-profile
---

Prompt body`

		const parsed = parseAgentConfigFromYaml(content)

		assert.equal((parsed as { profile?: string }).profile, undefined)
		assert.equal("modelId" in parsed, false)
	})

	it("throws for unknown tools", () => {
		const content = `---
name: bad-agent
description: bad
tools: Read, NotARealTool
profile: bad-profile
---

Prompt body`

		assert.throws(() => parseAgentConfigFromYaml(content), /Unknown tool/)
	})

	it("returns an empty config map when the agents directory does not exist", async () => {
		const tempHome = await createTempHomeDir()
		tempDirs.push(tempHome)

		const result = await readAgentConfigsFromDisk(path.join(tempHome, "Documents", "Dline", AGENTS_CONFIG_DIRECTORY_NAME))
		assert.equal(result.size, 0)
	})

	it("loads all yaml/yml files from homeDir/.cline/data/agents", async () => {
		const tempHome = await createTempHomeDir()
		tempDirs.push(tempHome)

		const directoryPath = path.join(tempHome, "Documents", "Dline", AGENTS_CONFIG_DIRECTORY_NAME)
		await fs.mkdir(directoryPath, { recursive: true })
		await fs.writeFile(
			path.join(directoryPath, "local-agent.yaml"),
			`---
name: local-agent
description: local agent
tools: read_file
profile: local-profile
---

Prompt body`,
			"utf8",
		)
		await fs.writeFile(
			path.join(directoryPath, "reviewer.yml"),
			`---
name: reviewer
description: reviewer agent
tools: list_files
profile: reviewer-profile
---

Reviewer prompt`,
			"utf8",
		)
		await fs.writeFile(path.join(directoryPath, "ignored.txt"), "not yaml", "utf8")

		const loader = AgentConfigLoader.getInstance(directoryPath)
		await loader.load()

		const localAgent = loader.getCachedConfig("local-agent")
		const reviewer = loader.getCachedConfig("reviewer")
		assert.equal(localAgent?.name, "local-agent")
		assert.deepEqual(localAgent?.tools, [ClineDefaultTool.FILE_READ])
		assert.equal(localAgent?.systemPrompt, "Prompt body")
		assert.equal(reviewer?.name, "reviewer")
		assert.deepEqual(reviewer?.tools, [ClineDefaultTool.LIST_FILES])
		assert.equal(loader.getAllCachedConfigs().size, 2)
	})

	it("creates dynamic subagent tool mappings after loading configs", async () => {
		const tempHome = await createTempHomeDir()
		tempDirs.push(tempHome)

		const directoryPath = path.join(tempHome, "Documents", "Dline", AGENTS_CONFIG_DIRECTORY_NAME)
		await fs.mkdir(directoryPath, { recursive: true })
		await fs.writeFile(
			path.join(directoryPath, "code-reviewer.yaml"),
			`---
name: code reviewer
description: reviewer agent
tools: read_file
profile: reviewer-profile
---

Reviewer prompt`,
			"utf8",
		)

		const loader = AgentConfigLoader.getInstance(directoryPath)
		await loader.load()

		const withToolNames = loader.getAllCachedConfigsWithToolNames()
		assert.equal(withToolNames.length, 1)
		assert.equal(withToolNames[0].config.name, "code reviewer")
		assert.equal(loader.resolveSubagentNameForTool(withToolNames[0].toolName), "code reviewer")
		assert.equal(loader.isDynamicSubagentTool(withToolNames[0].toolName), true)
		assert.ok(getToolUseNames().includes(withToolNames[0].toolName))
	})
})
