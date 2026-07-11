import { resolve } from "node:path"
import react from "@vitejs/plugin-react-swc"
import { defineConfig } from "vitest/config"

export default defineConfig({
	root: __dirname,
	plugins: [react()],
	test: {
		name: "webview",
		environment: "jsdom",
		include: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.spec.ts", "src/**/*.spec.tsx"],
		globals: true,
		setupFiles: ["./src/setupTests.ts"],
		testTimeout: 60_000,
		clearMocks: false,
		restoreMocks: false,
		pool: "vmThreads",
		maxWorkers: 2,
		vmMemoryLimit: "768MB",
	},
	resolve: {
		alias: {
			"@": resolve(__dirname, "./src"),
			"@components": resolve(__dirname, "./src/components"),
			"@context": resolve(__dirname, "./src/context"),
			"@shared": resolve(__dirname, "../src/shared"),
			"@utils": resolve(__dirname, "./src/utils"),
		},
	},
})
