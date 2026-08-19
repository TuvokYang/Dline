import { strict as assert } from "node:assert"
import { UpdateSubagentConfigRequest } from "@shared/proto/dline/file"
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

	it("preserves tools and skills when a profile-only protobuf patch omits list replacement", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "update-subagent-config-"))
		temporaryDirectories.push(directory)
		const subagentPath = path.join(directory, "reviewer.yml")
		await fs.writeFile(
			subagentPath,
			"---\nname: reviewer\ndescription: Research agent\ntools:\n  - read_file\n  - search_files\nskills:\n  - systematic-debugging\nprofile: old-profile\n---\nCustom reviewer instructions.\n",
			"utf8",
		)

		const request = UpdateSubagentConfigRequest.decode(
			UpdateSubagentConfigRequest.encode(
				UpdateSubagentConfigRequest.create({
					subagentPath,
					profile: "own-openai:deepseek-v4-flash",
				}),
			).finish(),
		)
		await updateSubagentConfig({} as never, request)

		const content = await fs.readFile(subagentPath, "utf8")
		assert.match(content, /tools:\n\s{2}- read_file\n\s{2}- search_files/)
		assert.match(content, /skills:\n\s{2}- systematic-debugging/)
		assert.match(content, /description: Research agent/)
		assert.match(content, /profile: "own-openai:deepseek-v4-flash"/)
		assert.match(content, /Custom reviewer instructions\./)
	})

	it("clears tools and skills only when replacement intent is explicit", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "update-subagent-config-"))
		temporaryDirectories.push(directory)
		const subagentPath = path.join(directory, "reviewer.yml")
		await fs.writeFile(
			subagentPath,
			"---\nname: reviewer\ndescription: Research agent\ntools:\n  - read_file\nskills:\n  - systematic-debugging\n---\nPrompt body\n",
			"utf8",
		)

		await updateSubagentConfig(
			{} as never,
			UpdateSubagentConfigRequest.create({
				subagentPath,
				tools: [],
				skills: [],
				replaceTools: true,
				replaceSkills: true,
			}),
		)

		const content = await fs.readFile(subagentPath, "utf8")
		assert.match(content, /tools: \[\]/)
		assert.match(content, /skills: \[\]/)
		assert.match(content, /Prompt body/)
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
