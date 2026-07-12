import { describe, expect, it } from "vitest"
import config from "../../vitest.config"
import webviewConfig from "../../webview-ui/vitest.config"

interface TestProjectConfig {
	test?: {
		name?: string
		include?: string[]
		exclude?: string[]
		setupFiles?: string[]
		environment?: string
		pool?: string
		maxWorkers?: number
		minWorkers?: number
		vmMemoryLimit?: string
	}
}

interface RootTestConfig {
	test?: {
		projects?: Array<TestProjectConfig | string>
	}
}

describe("Vitest project isolation", () => {
	/** Verifies backend domains and Webview run in bounded recyclable projects. */
	it("defines bounded backend and webview projects", () => {
		const rootConfig = config as RootTestConfig
		const projects = rootConfig.test?.projects ?? []
		const backendProjects = projects
			.slice(0, -1)
			.filter((project): project is TestProjectConfig => typeof project !== "string")
		const backendByName = new Map(backendProjects.map((project) => [project.test?.name, project.test]))
		const webview = (webviewConfig as TestProjectConfig).test

		expect(projects).toHaveLength(6)
		expect(projects[5]).toBe("webview-ui/vitest.config.ts")
		expect([...backendByName.keys()]).toEqual(["backend-task", "backend-prompts", "backend-hooks", "backend-core", "backend"])
		expect(backendByName.get("backend-task")?.include).toEqual(["src/core/task/**/*.test.ts"])
		expect(backendByName.get("backend-prompts")?.include).toEqual(["src/core/prompts/**/*.test.ts"])
		expect(backendByName.get("backend-hooks")?.include).toEqual(["src/core/hooks/**/*.test.ts"])
		expect(backendByName.get("backend-core")?.include).toEqual(["src/core/**/*.test.ts"])
		expect(backendByName.get("backend")?.include).toEqual(["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"])
		expect(backendByName.get("backend-core")?.exclude).toEqual(
			expect.arrayContaining(["src/core/task/**", "src/core/prompts/**", "src/core/hooks/**"]),
		)
		expect(backendByName.get("backend")?.exclude).toContain("src/core/**")
		expect(webview?.include).toEqual(["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.spec.ts", "src/**/*.spec.tsx"])

		for (const project of [...backendProjects.map((entry) => entry.test), webview]) {
			expect(project?.environment).toBe(project === webview ? "jsdom" : "node")
			expect(project?.setupFiles).toEqual(project === webview ? ["./src/setupTests.ts"] : ["src/test/setup.ts"])
			expect(project?.pool).toBe("vmThreads")
			expect(project?.maxWorkers).toBe(2)
			expect(project?.minWorkers).toBe(project === webview ? undefined : 1)
			expect(project?.vmMemoryLimit).toBeUndefined()
		}
	})
})
