import { defineConfig } from "@playwright/test"
import baseConfig from "./playwright.config"

export default defineConfig({
	...baseConfig,
	workers: 1,
	retries: 0,
	fullyParallel: false,
	testMatch: /.*\.legacy\.ts/,
	projects: [{ name: "legacy upgrade e2e" }],
})
