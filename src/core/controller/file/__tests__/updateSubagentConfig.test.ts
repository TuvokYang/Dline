import { strict as assert } from "node:assert"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterEach, describe, it } from "vitest"
import { updateSubagentConfig } from "../updateSubagentConfig"

const temporaryDirectories: string[] = []

describe("updateSubagentConfig", () => {
	afterEach(async () => {
		await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
	})

	it("keeps YAML frontmatter delimiters on separate lines when updating fields", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "update-subagent-config-"))
		temporaryDirectories.push(directory)
		const subagentPath = path.join(directory, "reviewer.yml")
		await fs.writeFile(
			subagentPath,
			"---\nname: reviewer\ndescription: Research and exploration subagent\ntools: []\nskills: []\nprofile: old-profile\n---\nPrompt body\n",
			"utf8",
		)

		await updateSubagentConfig(
			{} as never,
			{
				subagentPath,
				profile: "deepseek:deepseek-v4-pro",
				tools: [],
				skills: [],
				description: "Research and exploration subagent",
			} as never,
		)

		const content = await fs.readFile(subagentPath, "utf8")
		assert.match(content, /^---\nname: reviewer\n/)
		assert.doesNotMatch(content, /^---name:/)
		assert.match(content, /\n---\nPrompt body/)
	})
})
