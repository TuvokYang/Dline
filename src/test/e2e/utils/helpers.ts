import {
	cpSync,
	existsSync,
	mkdtempSync,
	type PathLike,
	type RmOptions,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { type ElectronApplication, expect, type Frame, type Page, test } from "@playwright/test"
import { downloadAndUnzipVSCode, SilentReporter } from "@vscode/test-electron"
import { _electron } from "playwright"
import { ClineApiServerMock } from "../fixtures/server"
import { type E2EProfileMode, type PreparedE2EState, prepareE2EState } from "./api-profile"

interface E2ETestDirectories {
	workspaceDir: string
	multiRootWorkspaceDir: string
	userDataDir: string
	dlineDir: string
	dlineHomeDir: string
	dlineDocsDir: string
}

interface E2EWorkerFixtures {
	server: ClineApiServerMock
	dlineStateTemplateDir: string
	preparedE2EState: PreparedE2EState
	profileMode: E2EProfileMode
}

export interface E2ETestConfigs {
	workspaceType: "single" | "multi"
	channel: "stable" | "insiders"
}

export class E2ETestHelper {
	// Constants
	public static readonly CODEBASE_ROOT_DIR = path.resolve(__dirname, "..", "..", "..", "..")
	public static readonly E2E_TESTS_DIR = path.join(E2ETestHelper.CODEBASE_ROOT_DIR, "src", "test", "e2e")
	public static readonly DLINE_DIR = path.join(os.tmpdir(), ".dline-e2e")
	public static readonly DLINE_DOCS_DIR = path.join(os.tmpdir(), "dline-e2e")
	public static readonly DLINE_STATE_TEMPLATE_DIR = path.join(os.tmpdir(), ".dline-e2e-template")

	// Instance properties for caching
	private cachedFrame: Frame | null = null

	// Path utilities
	public static escapeToPath(text: string): string {
		return text.trim().toLowerCase().replaceAll(/\W/g, "_")
	}

	public static getResultsDir(testName = "", label?: string): string {
		const testDir = path.join(
			E2ETestHelper.CODEBASE_ROOT_DIR,
			"test-results",
			"playwright",
			E2ETestHelper.escapeToPath(testName),
		)
		return label ? path.join(testDir, label) : testDir
	}

	/**
	 * Generates a filename for gRPC recorder logs based on test information
	 * @param testTitle The title of the test
	 * @param projectName The name of the test project (optional)
	 * @returns A sanitized filename suitable for gRPC recorder logs
	 */
	public static generateTestFileName(testTitle: string, projectName?: string): string {
		// Create a base name from the test title
		const baseName = E2ETestHelper.escapeToPath(testTitle)

		// Add project name if provided and different from default
		const projectSuffix = projectName && projectName !== "e2e tests" ? `_${E2ETestHelper.escapeToPath(projectName)}` : ""

		return `${baseName}${projectSuffix}`
	}

	public static async waitUntil(predicate: () => boolean | Promise<boolean>, maxDelay = 10000): Promise<void> {
		let delay = 10
		const start = Date.now()

		while (!(await predicate())) {
			if (Date.now() - start > maxDelay) {
				throw new Error(`waitUntil timeout after ${maxDelay}ms`)
			}
			await new Promise((resolve) => setTimeout(resolve, delay))
			delay = Math.min(delay << 1, 1000) // Cap at 1s
		}
	}

	public static async waitForValue<T>(predicate: () => T | undefined | Promise<T | undefined>, maxDelay = 10000): Promise<T> {
		let value: T | undefined
		await E2ETestHelper.waitUntil(async () => {
			value = await predicate()
			return value !== undefined
		}, maxDelay)
		return value as T
	}

	public async getSidebar(page: Page): Promise<Frame> {
		const consoleErrors: string[] = []
		const pageErrors: string[] = []
		const onConsole = (message: { type(): string; text(): string }) => {
			if (message.type() === "error") consoleErrors.push(message.text())
		}
		const onPageError = (error: Error) => pageErrors.push(error.stack ?? error.message)
		page.on("console", onConsole)
		page.on("pageerror", onPageError)

		const findSidebarFrame = async (): Promise<Frame | null> => {
			// Check cached frame first
			if (this.cachedFrame && !this.cachedFrame.isDetached()) {
				return this.cachedFrame
			}

			for (const frame of page.frames()) {
				if (frame.isDetached()) {
					continue
				}

				try {
					const title = await frame.title()
					const isNamedDlineFrame = title.startsWith("Cline") || title.startsWith("Dline")
					const isVsCodeWebviewFrame =
						frame !== page.mainFrame() &&
						frame.url().startsWith("vscode-webview://") &&
						(await frame.locator("#root").count()) > 0
					if (isNamedDlineFrame || isVsCodeWebviewFrame) {
						this.cachedFrame = frame
						return frame
					}
				} catch (error: any) {
					if (!error.message.includes("detached") && !error.message.includes("navigation")) {
						throw error
					}
				}
			}
			return null
		}

		// Use longer timeout (30s) for sidebar - macOS CI runners can be slow
		try {
			await E2ETestHelper.waitUntil(async () => (await findSidebarFrame()) !== null, 30000)
		} catch (error) {
			const observedFrames: Array<{ title?: string; url: string; rootCount?: number; error?: string }> = []
			for (const frame of page.frames()) {
				try {
					observedFrames.push({
						title: await frame.title(),
						url: frame.url(),
						rootCount: await frame.locator("#root").count(),
					})
				} catch (frameError) {
					observedFrames.push({
						url: frame.url(),
						error: frameError instanceof Error ? frameError.message : String(frameError),
					})
				}
			}
			const dlineTabs = await page.getByRole("tab", { name: /Dline/ }).evaluateAll((elements) =>
				elements.map((element) => ({
					ariaExpanded: element.getAttribute("aria-expanded"),
					ariaSelected: element.getAttribute("aria-selected"),
					className: element.className,
					outerHtml: element.outerHTML.slice(0, 1_000),
				})),
			)
			const webviewHosts = await page.locator("iframe, webview").evaluateAll((elements) =>
				elements.map((element) => ({
					className: element.className,
					hidden: element.hasAttribute("hidden"),
					outerHtml: element.outerHTML.slice(0, 1_000),
				})),
			)
			throw new Error(
				`Dline sidebar frame unavailable; observed=${JSON.stringify({ observedFrames, dlineTabs, webviewHosts, consoleErrors, pageErrors })}`,
				{ cause: error },
			)
		} finally {
			page.off("console", onConsole)
			page.off("pageerror", onPageError)
		}
		return (await findSidebarFrame()) || page.mainFrame()
	}

	public static async rmForRetries(path: PathLike, options?: RmOptions): Promise<void> {
		const maxAttempts = 3 // Reduced from 5

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				rmSync(path, options)
				return
			} catch (error) {
				if (attempt === maxAttempts) {
					throw new Error(`Failed to rmSync ${path} after ${maxAttempts} attempts: ${error}`)
				}
				await new Promise((resolve) => setTimeout(resolve, 50 * attempt)) // Progressive delay
			}
		}
	}

	public async signin(webview: Frame): Promise<void> {
		const bringYourOwnKey = webview.getByText("Bring my own API key")
		const chatInput = webview.getByTestId("chat-input")
		await expect(bringYourOwnKey.or(chatInput)).toBeVisible()

		if (await bringYourOwnKey.isVisible()) {
			await bringYourOwnKey.click()
			await webview.getByRole("button", { name: "Continue" }).click()
			await webview.getByRole("button", { name: "Add API" }).click()

			const providerSelector = webview.getByRole("combobox").first()
			await providerSelector.selectOption("openrouter")
			await webview.getByRole("textbox", { name: "OpenRouter API Key" }).fill("test-api-key")
			await webview.getByRole("button", { name: "Continue" }).click()
		}

		await expect(chatInput).toBeVisible()

		// Dismiss "What's New" version announcement if present
		await E2ETestHelper.dismissWhatsNewModal(webview)
	}

	public static async openClineSidebar(page: Page): Promise<void> {
		const dlineTab = page.getByRole("tab", { name: /Dline/ })
		await expect(dlineTab).toBeVisible({ timeout: 30_000 })
		if ((await dlineTab.getAttribute("aria-expanded")) !== "true") {
			await dlineTab.locator("a").click()
		}
		await expect(dlineTab).toHaveAttribute("aria-expanded", "true")
	}

	public static async runCommandPalette(page: Page, command: string): Promise<void> {
		await page.keyboard.press("F1")
		const commandInput = page.locator(".quick-input-widget input").last()
		await expect(commandInput).toBeVisible()
		await commandInput.fill(command)
		await commandInput.press("Enter")
	}

	private static findDlineOutputLogs(directory: string): string[] {
		if (!existsSync(directory)) return []
		const result: string[] = []
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const entryPath = path.join(directory, entry.name)
			if (entry.isDirectory()) result.push(...E2ETestHelper.findDlineOutputLogs(entryPath))
			else if (/^\d+-Dline\.log$/i.test(entry.name)) result.push(entryPath)
		}
		return result
	}

	/** Read the backing log for the live Dline VS Code Output channel. */
	public static async readDlineOutput(userDataDir: string): Promise<string> {
		const outputPath = await E2ETestHelper.waitForValue(() => {
			const candidates = E2ETestHelper.findDlineOutputLogs(path.join(userDataDir, "logs"))
			return candidates.sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0]
		}, 10_000)
		return readFileSync(outputPath, "utf8")
	}

	/** Fail when the Dline output channel contains an unexpected internal error. */
	public static async expectNoUnexpectedDlineErrors(userDataDir: string, allowed: RegExp[] = []): Promise<void> {
		const output = await E2ETestHelper.readDlineOutput(userDataDir)
		const suspiciousLines = output
			.split(/\r?\n/)
			.filter((line) => /\[error\]|uncaught|unhandled|TypeError|ReferenceError|invalid_runtime_event/i.test(line))
		const unexpected = suspiciousLines.filter((line) => !allowed.some((pattern) => pattern.test(line)))
		expect(unexpected, `Unexpected Dline output errors:\n${unexpected.join("\n")}`).toEqual([])
	}

	// Clear cached frame when needed
	public clearCachedFrame(): void {
		this.cachedFrame = null
	}

	/** Dismiss "What's New" version announcement modal if visible. */
	public static async dismissWhatsNewModal(sidebar: Frame): Promise<void> {
		const whatsNewDialog = sidebar.getByRole("heading", { name: /New in v/ })
		try {
			await whatsNewDialog.waitFor({ state: "visible", timeout: 5000 })
			await sidebar.getByRole("button", { name: "Close" }).click()
			await expect(whatsNewDialog).not.toBeVisible()
		} catch {
			// "What's New" modal did not appear
		}
	}
}

/**
 * NOTE: Use the `e2e` test fixture for all E2E tests to test the Cline extension.
 *
 * Extended Playwright test configuration for Cline E2E testing.
 *
 * This test configuration provides a comprehensive setup for end-to-end testing of the Cline VS Code extension,
 * including server mocking, temporary directories, VS Code instance management, and helper utilities.
 *
 * NOTE: Tests select single-root or multi-root workspaces through the `workspaceType` fixture.
 *
 * @extends test - Base Playwright test with multiple fixture extensions
 *
 * Fixtures provided:
 * - `server`: Shared ClineApiServerMock instance for API mocking (reused across all tests)
 * - `workspaceDir`: Path to the test workspace directory
 * - `userDataDir`: Temporary directory for VS Code user data
 * - `openVSCode`: Function that returns a Promise resolving to an ElectronApplication instance
 * - `app`: ElectronApplication instance with automatic cleanup
 * - `helper`: E2ETestHelper instance for test utilities
 * - `page`: Playwright Page object representing the main VS Code window with Cline sidebar opened
 * - `sidebar`: Playwright Frame object representing the Cline extension's sidebar iframe
 *
 * @returns Extended test object with all fixtures available for E2E test scenarios:
 * - **server**: Automatically starts and manages a ClineApiServerMock instance
 * - **workspaceDir**: Sets up a test workspace directory from fixtures
 * - **userDataDir**: Creates a temporary directory for VS Code user data
 * - **openVSCode**: Factory function that launches VS Code with proper configuration for testing
 * - **app**: Manages the VS Code ElectronApplication lifecycle with automatic cleanup
 * - **helper**: Provides E2ETestHelper utilities for test operations
 * - **page**: Configures the main VS Code window with notifications disabled and Cline sidebar open
 * - **sidebar**: Provides access to the Cline extension's sidebar frame
 *
 * @example
 * ```typescript
 * e2e('should perform basic operations', async ({ sidebar, helper }) => {
 *   // Test implementation using the configured sidebar and helper
 * });
 * ```
 *
 * @remarks
 * - Automatically handles VS Code download and setup
 * - Installs the Cline extension in development mode
 * - Records test videos for debugging
 * - Performs cleanup of temporary directories after each test
 * - Configures VS Code with disabled updates, workspace trust, and welcome screens
 */
export const e2e = test
	.extend<E2ETestConfigs>({
		workspaceType: "single",
		channel: "stable",
	})
	.extend<E2ETestDirectories, E2EWorkerFixtures>({
		profileMode: ["mock", { scope: "worker", option: true }],
		server: [
			async ({}, use) => {
				const server = await ClineApiServerMock.startGlobalServer()
				try {
					await use(server)
				} finally {
					await ClineApiServerMock.stopGlobalServer()
				}
			},
			{ scope: "worker" },
		],
		preparedE2EState: [
			async ({ server, profileMode }, use) => {
				const templateDir = E2ETestHelper.DLINE_STATE_TEMPLATE_DIR
				await Promise.all([
					E2ETestHelper.rmForRetries(templateDir, { recursive: true, force: true }),
					E2ETestHelper.rmForRetries(E2ETestHelper.DLINE_DIR, { recursive: true, force: true }),
					E2ETestHelper.rmForRetries(E2ETestHelper.DLINE_DOCS_DIR, { recursive: true, force: true }),
				])
				try {
					const preparedState = await prepareE2EState({
						dlineDir: templateDir,
						mockBaseUrl: server.baseUrl,
						profileMode,
					})
					await use(preparedState)
				} finally {
					await Promise.all([
						E2ETestHelper.rmForRetries(templateDir, { recursive: true, force: true }),
						E2ETestHelper.rmForRetries(E2ETestHelper.DLINE_DIR, { recursive: true, force: true }),
						E2ETestHelper.rmForRetries(E2ETestHelper.DLINE_DOCS_DIR, { recursive: true, force: true }),
					])
				}
			},
			{ scope: "worker" },
		],
		dlineStateTemplateDir: [
			async ({ preparedE2EState }, use) => {
				await use(preparedE2EState.dlineDir)
			},
			{ scope: "worker" },
		],
		workspaceDir: async ({}, use) => {
			const fixtureRoot = path.join(E2ETestHelper.E2E_TESTS_DIR, "fixtures")
			const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "dline-e2e-workspace-"))
			const workspaceDir = path.join(temporaryRoot, "workspace")
			cpSync(path.join(fixtureRoot, "workspace"), workspaceDir, { recursive: true })
			try {
				await use(workspaceDir)
			} finally {
				await E2ETestHelper.rmForRetries(temporaryRoot, { recursive: true, force: true })
			}
		},
		multiRootWorkspaceDir: async ({}, use) => {
			// DOCS: https://code.visualstudio.com/docs/editing/workspaces/multi-root-workspaces
			const fixtureRoot = path.join(E2ETestHelper.E2E_TESTS_DIR, "fixtures")
			const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "dline-e2e-multiroot-"))
			cpSync(path.join(fixtureRoot, "workspace"), path.join(temporaryRoot, "workspace"), { recursive: true })
			cpSync(path.join(fixtureRoot, "workspace_2"), path.join(temporaryRoot, "workspace_2"), { recursive: true })
			const workspaceFile = path.join(temporaryRoot, "multiroots.code-workspace")
			cpSync(path.join(fixtureRoot, "multiroots.code-workspace"), workspaceFile)
			try {
				await use(workspaceFile)
			} finally {
				await E2ETestHelper.rmForRetries(temporaryRoot, { recursive: true, force: true })
			}
		},
		userDataDir: async ({}, use, testInfo) => {
			const userDataDir = mkdtempSync(path.join(os.tmpdir(), "dline-e2e-user-data-"))
			try {
				await use(userDataDir)
			} finally {
				const logsDir = path.join(userDataDir, "logs")
				if (testInfo.status !== testInfo.expectedStatus && existsSync(logsDir)) {
					cpSync(logsDir, testInfo.outputPath("vscode-logs"), { recursive: true })
				}
				await E2ETestHelper.rmForRetries(userDataDir, { recursive: true, force: true })
			}
		},
		dlineDir: async ({ dlineStateTemplateDir, server }, use, testInfo) => {
			const dlineDir = E2ETestHelper.DLINE_DIR
			server.resetOpenAiMock()
			await Promise.all([
				E2ETestHelper.rmForRetries(dlineDir, { recursive: true, force: true }),
				E2ETestHelper.rmForRetries(E2ETestHelper.DLINE_DOCS_DIR, { recursive: true, force: true }),
			])
			cpSync(dlineStateTemplateDir, dlineDir, { recursive: true })
			try {
				await use(dlineDir)
			} finally {
				const taskStateDir = path.join(E2ETestHelper.DLINE_DOCS_DIR, "tasks")
				if (testInfo.status !== testInfo.expectedStatus && existsSync(taskStateDir)) {
					cpSync(taskStateDir, testInfo.outputPath("dline-task-state"), { recursive: true })
				}
				await Promise.all([
					E2ETestHelper.rmForRetries(dlineDir, { recursive: true, force: true }),
					E2ETestHelper.rmForRetries(E2ETestHelper.DLINE_DOCS_DIR, { recursive: true, force: true }),
				])
			}
		},
		dlineHomeDir: async ({ dlineDir }, use) => {
			await use(dlineDir)
		},
		dlineDocsDir: async ({ dlineDir }, use) => {
			void dlineDir
			await use(E2ETestHelper.DLINE_DOCS_DIR)
		},
	})
	.extend<{ openVSCode: (workspacePath: string) => Promise<ElectronApplication> }>({
		openVSCode: async ({ userDataDir, dlineDir, dlineHomeDir, dlineDocsDir, channel, server }, use, testInfo) => {
			const executablePath = await downloadAndUnzipVSCode(channel, undefined, new SilentReporter())
			const electronEnvironment = { ...process.env }
			delete electronEnvironment.ELECTRON_RUN_AS_NODE
			const cdpPort = process.env.DLINE_E2E_CDP_PORT?.trim()
			if (cdpPort && (!/^\d+$/.test(cdpPort) || Number(cdpPort) < 1 || Number(cdpPort) > 65_535)) {
				throw new Error(`Invalid DLINE_E2E_CDP_PORT: ${cdpPort}`)
			}

			await use(async (workspacePath: string) => {
				const app = await _electron.launch({
					executablePath,
					env: {
						...electronEnvironment,
						E2E_TEST: "true",
						DLINE_ENVIRONMENT: "local",
						DLINE_DIR: dlineDir,
						DLINE_HOME_DIR: dlineHomeDir,
						DLINE_E2E_API_BASE_URL: server.baseUrl,
						DLINE_SKIP_MIGRATION: "1",
						DLINE_DOCS_DIR: dlineDocsDir,
						GRPC_RECORDER_FILE_NAME: E2ETestHelper.generateTestFileName(testInfo.title, testInfo.project.name),
						// GRPC_RECORDER_ENABLED: "true",
						// GRPC_RECORDER_TESTS_FILTERS_ENABLED: "true"
						// IS_DEV: "true",
						DEV_WORKSPACE_FOLDER: E2ETestHelper.CODEBASE_ROOT_DIR,
					},
					recordVideo: {
						dir: E2ETestHelper.getResultsDir(testInfo.title, "recordings"),
					},
					args: [
						"--no-sandbox",
						...(cdpPort ? [`--remote-debugging-port=${cdpPort}`] : []),
						"--disable-updates",
						"--disable-workspace-trust",
						"--disable-extensions", // Run VS Code with all extensions disabled other than the one under test.
						"--skip-welcome",
						"--skip-release-notes",
						`--user-data-dir=${userDataDir}`,
						`--install-extension=${path.join(E2ETestHelper.CODEBASE_ROOT_DIR, "dist", "e2e.vsix")}`,
						`--extensionDevelopmentPath=${E2ETestHelper.CODEBASE_ROOT_DIR}`,
						workspacePath,
					],
				})
				await E2ETestHelper.waitUntil(() => app.windows().length > 0)
				return app
			})
		},
	})
	.extend<{ app: ElectronApplication }>({
		app: async ({ openVSCode, workspaceType, workspaceDir, multiRootWorkspaceDir }, use) => {
			const workspacePath = workspaceType === "single" ? workspaceDir : multiRootWorkspaceDir
			const app = await openVSCode(workspacePath)

			try {
				await use(app)
			} finally {
				await app.close()
			}
		},
	})
	.extend<{ helper: E2ETestHelper }>({
		helper: async ({}, use) => {
			const helper = new E2ETestHelper()
			await use(helper)
		},
	})
	.extend({
		page: async ({ app }, use) => {
			const page = await app.firstWindow()
			await use(page)
		},
	})
	.extend<{ sidebar: Frame }>({
		sidebar: async ({ page, helper, server }, use) => {
			await E2ETestHelper.openClineSidebar(page)
			const sidebar = await helper.getSidebar(page)
			// Auto-dismiss "What's New" version announcement if present
			await E2ETestHelper.dismissWhatsNewModal(sidebar)
			await use(sidebar)
		},
	})

export const E2E_WORKSPACE_TYPES = [
	{ title: "Single Root", workspaceType: "single" },
	{ title: "Multi-Roots", workspaceType: "multi" },
] as const
