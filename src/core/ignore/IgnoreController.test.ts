import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { IgnoreController } from "./IgnoreController"

const controllers: IgnoreController[] = []
const workspaces: string[] = []

async function createWorkspace(files: Record<string, string>): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "ignore-controller-"))
	workspaces.push(root)
	for (const [relativePath, content] of Object.entries(files)) {
		const target = path.join(root, relativePath)
		await fs.mkdir(path.dirname(target), { recursive: true })
		await fs.writeFile(target, content, "utf8")
	}
	return root
}

async function loadRules(files: Record<string, string>): Promise<{ cwd: string; rules: IgnoreController }> {
	const cwd = await createWorkspace(files)
	const rules = await IgnoreController.loadSnapshot(cwd)
	controllers.push(rules)
	return { cwd, rules }
}

afterEach(async () => {
	await Promise.all(controllers.splice(0).map((controller) => controller.dispose()))
	await Promise.all(workspaces.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("IgnoreController", () => {
	describe("scopes", () => {
		it("keeps agent rules out of the git scope", async () => {
			const { cwd, rules } = await loadRules({
				".gitignore": "build/\n",
				".agentignore": "secrets/\n",
			})

			expect(rules.validateAccess(path.join(cwd, "secrets/key.txt"), "git")).toBe(true)
			expect(rules.validateAccess(path.join(cwd, "secrets/key.txt"), "agent")).toBe(false)
		})

		it("layers agent rules on top of the repository rules", async () => {
			const { cwd, rules } = await loadRules({
				".gitignore": "build/\n",
				".agentignore": "secrets/\n",
			})

			// The repository rule still applies to the agent scope.
			expect(rules.validateAccess(path.join(cwd, "build/app.js"), "agent")).toBe(false)
		})

		it("keeps a repository-ignored path readable while excluding it from discovery", async () => {
			const { cwd, rules } = await loadRules({
				".gitignore": ".memory-bank/\n",
				".agentignore": "secrets/\n",
			})

			// Not tracking a path says nothing about whether opening it is allowed.
			expect(rules.validateAccess(path.join(cwd, ".memory-bank/notes.md"), "agent")).toBe(false)
			expect(rules.validateAccess(path.join(cwd, ".memory-bank/notes.md"), "read")).toBe(true)
		})

		it("blocks agent-excluded paths from being read", async () => {
			const { cwd, rules } = await loadRules({
				".gitignore": "build/\n",
				".agentignore": "secrets/\n",
			})

			expect(rules.validateAccess(path.join(cwd, "secrets/key.txt"), "read")).toBe(false)
			expect(rules.validateAccess(path.join(cwd, "src/app.ts"), "read")).toBe(true)
		})

		it("lets an agent negation re-admit a repository-ignored file", async () => {
			// gitignore semantics: a file inside an excluded directory cannot be
			// re-included, so the repository rule must target the file itself.
			const { cwd, rules } = await loadRules({
				".gitignore": "*.log\n",
				".agentignore": "!audit.log\n",
			})

			expect(rules.validateAccess(path.join(cwd, "audit.log"), "agent")).toBe(true)
			expect(rules.validateAccess(path.join(cwd, "audit.log"), "git")).toBe(false)
		})

		it("allows every path when the workspace has no rule files", async () => {
			const { cwd, rules } = await loadRules({ "src/app.ts": "" })

			expect(rules.validateAccess(path.join(cwd, "src/app.ts"), "agent")).toBe(true)
			expect(rules.getIgnoreContent("agent")).toBeUndefined()
		})
	})

	describe("accepted filenames", () => {
		it("reads .dlineignore when .agentignore is absent", async () => {
			const { cwd, rules } = await loadRules({ ".dlineignore": "secrets/\n" })

			expect(rules.validateAccess(path.join(cwd, "secrets/key.txt"), "agent")).toBe(false)
		})

		it("reads .clineignore when the preferred names are absent", async () => {
			const { cwd, rules } = await loadRules({ ".clineignore": "secrets/\n" })

			expect(rules.validateAccess(path.join(cwd, "secrets/key.txt"), "agent")).toBe(false)
		})

		it("uses only the highest-precedence file", async () => {
			const { cwd, rules } = await loadRules({
				".agentignore": "current/\n",
				".clineignore": "superseded/\n",
			})

			expect(rules.validateAccess(path.join(cwd, "current/a.txt"), "agent")).toBe(false)
			expect(rules.validateAccess(path.join(cwd, "superseded/a.txt"), "agent")).toBe(true)
		})
	})

	describe("shouldIgnoreDirectory", () => {
		it("prunes the built-in directories without any rule file", async () => {
			const { cwd, rules } = await loadRules({ "src/app.ts": "" })

			expect(rules.shouldIgnoreDirectory(path.join(cwd, "node_modules"))).toBe(true)
			expect(rules.shouldIgnoreDirectory(path.join(cwd, "tmp"))).toBe(true)
			expect(rules.shouldIgnoreDirectory(path.join(cwd, "src"))).toBe(false)
		})

		it("prunes a directory named by the workspace rules", async () => {
			const { cwd, rules } = await loadRules({ ".agentignore": "coverage/\n" })

			expect(rules.shouldIgnoreDirectory(path.join(cwd, "coverage"))).toBe(true)
			expect(rules.shouldIgnoreDirectory(path.join(cwd, "packages/api/coverage"))).toBe(true)
		})

		it("never prunes the workspace root", async () => {
			const { cwd, rules } = await loadRules({ ".agentignore": "*\n" })

			expect(rules.shouldIgnoreDirectory(cwd)).toBe(false)
		})
	})

	describe("exports", () => {
		it("includes the built-in floor in the glob patterns", async () => {
			const { rules } = await loadRules({ "src/app.ts": "" })

			expect(rules.toGlobPatterns("agent")).toContain("**/node_modules/**")
		})

		it("translates directory and anchored rules into globs", async () => {
			const { rules } = await loadRules({ ".agentignore": "coverage/\n/generated\n" })

			const patterns = rules.toGlobPatterns("agent")
			expect(patterns).toContain("**/coverage/**")
			expect(patterns).toContain("generated/**")
		})

		it("emits the built-in floor in gitignore syntax", async () => {
			const { rules } = await loadRules({ ".gitignore": "build/\n" })

			const content = rules.toGitignoreContent("git")
			expect(content).toContain("node_modules/")
			expect(content).toContain("build/")
		})
	})

	describe("filterPaths", () => {
		it("drops the paths excluded by the requested scope", async () => {
			const { rules } = await loadRules({ ".agentignore": "secrets/\n" })

			expect(rules.filterPaths(["src/app.ts", "secrets/key.txt"], "agent")).toEqual(["src/app.ts"])
		})
	})
})
