import { resolve } from "path"
import type { Plugin } from "vite"
import { defineConfig, defineProject } from "vitest/config"

/**
 * Resolve webview-local @ imports before the root @ alias handles backend imports.
 */
function resolveWebviewAlias(): Plugin {
	return {
		name: "resolve-webview-alias",
		resolveId(source, importer) {
			if (!source.startsWith("@/") || !importer?.includes("webview-ui")) {
				return null
			}

			return resolve(__dirname, "webview-ui/src", source.slice(2))
		},
	}
}

const sharedTestConfig = {
	exclude: ["node_modules/**", "dist/**", "src/test/e2e/**"],
	globals: true,
	setupFiles: ["src/test/setup.ts"],
	testTimeout: 60_000,
	clearMocks: false,
	restoreMocks: false,
	pool: "vmThreads" as const,
	maxWorkers: 2,
	minWorkers: 1,
	vmMemoryLimit: "768MB",
}

const backendResolve = {
	alias: {
		"@": resolve(__dirname, "src"),
		"@api": resolve(__dirname, "src/core/api"),
		"@core": resolve(__dirname, "src/core"),
		"@generated": resolve(__dirname, "src/generated"),
		"@hosts": resolve(__dirname, "src/hosts"),
		"@integrations": resolve(__dirname, "src/integrations"),
		"@packages": resolve(__dirname, "src/packages"),
		"@services": resolve(__dirname, "src/services"),
		"@shared": resolve(__dirname, "src/shared"),
		"@utils": resolve(__dirname, "src/utils"),
	},
}

export default defineConfig({
	test: {
		projects: [
			defineProject({
				plugins: [resolveWebviewAlias()],
				resolve: backendResolve,
				test: {
					...sharedTestConfig,
					name: "backend",
					environment: "node",
					include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
				},
			}),
			"webview-ui/vitest.config.ts",
		],
	},
})
