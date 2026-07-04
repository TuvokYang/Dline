import { expect } from "chai"
import { afterEach, beforeEach, describe, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
	const createMockProcess = () => {
		const mockProcess = {
			stdin: {
				write: vi.fn(),
				end: vi.fn(),
			},
			stdout: {
				on: vi.fn(),
				resume: vi.fn(),
			},
			stderr: {
				on: vi.fn(() => {}),
			},
			on: vi.fn((event, callback) => {
				if (event === "close") {
					setImmediate(() => callback(0))
				}
				if (event === "error") {
				}
			}),
			killed: false,
			kill: vi.fn(),
			exitCode: 0,
			then: (onResolve: (value: any) => void) => {
				setImmediate(() => onResolve({ exitCode: 0 }))
				return Promise.resolve({ exitCode: 0 })
			},
			catch: () => Promise.resolve({ exitCode: 0 }),
			finally: (callback: () => void) => {
				setImmediate(callback)
				return Promise.resolve({ exitCode: 0 })
			},
		}
		return mockProcess
	}

	const createMockReadlineInterface = () => ({
		async *[Symbol.asyncIterator]() {
			yield '{"type":"text","text":"Hello"}'
			yield '{"type":"text","text":" world"}'
			return
		},
		close: vi.fn(),
	})

	return {
		createMockReadlineInterface,
		mockExeca: vi.fn((..._args) => createMockProcess()),
		os: "darwin",
	}
})

vi.mock("@/utils/path", () => ({
	getCwd: () => Promise.resolve(process.cwd()),
}))

vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>()
	const mockedOs = {
		...actual,
		platform: () => mocks.os,
	}
	return {
		...mockedOs,
		default: mockedOs,
	}
})

vi.mock("execa", () => ({
	execa: mocks.mockExeca,
}))

vi.mock("readline", () => ({
	createInterface: mocks.createMockReadlineInterface,
	default: {
		createInterface: mocks.createMockReadlineInterface,
	},
}))

import { MAX_SYSTEM_PROMPT_LENGTH, runClaudeCode } from "./run"

describe("Claude Code Integration", () => {
	const scriptPath = "echo"

	afterEach(() => {
		vi.restoreAllMocks()
		mocks.mockExeca.mockClear()
		mocks.os = "darwin"
	})

	const itCallsTheScriptWithAFile = (systemPrompt: string) => {
		it("calls the script using with a file", async () => {
			const cProcess = runClaudeCode({
				systemPrompt,
				messages: [],
				modelId: "test",
				path: scriptPath,
			})

			const chunks: unknown[] = []
			for await (const chunk of cProcess) {
				chunks.push(chunk)
			}

			expect(chunks).to.have.length(2)

			const lastExecaCall = mocks.mockExeca.mock.lastCall
			const params = (lastExecaCall as any)[1]
			expect(params).to.not.be.null
			expect(params.includes("--system-prompt-file")).to.be.true
			expect(params.includes("--system-prompt")).to.be.false
		})
	}

	describe("when it's running on Windows", () => {
		beforeEach(() => {
			mocks.os = "win32"
		})

		describe("when the system prompt is longer than the MAX_SYSTEM_PROMPT_LENGTH", () => {
			const SYSTEM_PROMPT = "a".repeat(MAX_SYSTEM_PROMPT_LENGTH * 1.2)

			itCallsTheScriptWithAFile(SYSTEM_PROMPT)
		})

		describe("when the system prompt is shorter than the MAX_SYSTEM_PROMPT_LENGTH", () => {
			const SYSTEM_PROMPT = "a".repeat(MAX_SYSTEM_PROMPT_LENGTH / 2)

			itCallsTheScriptWithAFile(SYSTEM_PROMPT)
		})
	})

	describe("when it's not running on Windows", () => {
		beforeEach(() => {
			mocks.os = "darwin"
		})

		describe("when the system prompt is longer than the MAX_SYSTEM_PROMPT_LENGTH", () => {
			const SYSTEM_PROMPT = "a".repeat(MAX_SYSTEM_PROMPT_LENGTH * 1.2)

			itCallsTheScriptWithAFile(SYSTEM_PROMPT)
		})

		describe("when the system prompt is shorter than the MAX_SYSTEM_PROMPT_LENGTH", () => {
			const SYSTEM_PROMPT = "a".repeat(MAX_SYSTEM_PROMPT_LENGTH / 2)

			it("calls the script without a file", async () => {
				const cProcess = runClaudeCode({
					systemPrompt: SYSTEM_PROMPT,
					messages: [],
					modelId: "test",
					path: scriptPath,
				})

				const chunks: unknown[] = []
				for await (const chunk of cProcess) {
					chunks.push(chunk)
				}

				expect(chunks).to.have.length(2)

				const lastExecaCall = mocks.mockExeca.mock.lastCall
				const params = (lastExecaCall as any)[1]
				expect(params).to.not.be.null
				expect(params.includes("--system-prompt-file")).to.be.false
				expect(params.includes("--system-prompt")).to.be.true
			})
		})
	})
})
