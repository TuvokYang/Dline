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
	/** Verifies backend and Webview tests run in isolated recyclable projects. */
	it("defines bounded backend and webview projects", () => {
		const rootConfig = config as RootTestConfig
		const projects = rootConfig.test?.projects ?? []

		expect(projects).toHaveLength(2)
		expect(projects[1]).toBe("webview-ui/vitest.config.ts")

		const backendProject = projects[0]
		expect(typeof backendProject).toBe("object")
		const backend = typeof backendProject === "string" ? undefined : backendProject?.test
		const webview = (webviewConfig as TestProjectConfig).test
		expect(backend?.include).toEqual(["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"])
		expect(webview?.include).toEqual(["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.spec.ts", "src/**/*.spec.tsx"])
		expect(backend?.environment).toBe("node")
		expect(webview?.environment).toBe("jsdom")
		expect(backend?.setupFiles).toEqual(["src/test/setup.ts"])
		expect(backend?.exclude).toContain("src/test/e2e/**")
		expect(webview?.setupFiles).toEqual(["./src/setupTests.ts"])

		for (const project of [backend, webview]) {
			expect(project?.pool).toBe("vmThreads")
			expect(project?.maxWorkers).toBe(2)
			expect(project?.minWorkers).toBe(1)
			expect(project?.vmMemoryLimit).toBe("768MB")
		}
	})
})
