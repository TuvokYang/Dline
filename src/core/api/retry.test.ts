// @ts-nocheck — should library type issues
import { afterEach, describe, it, vi } from "vitest"
import "should"
// sinon import removed: using vitest globals
import { withRetry } from "./retry"

describe("Retry Decorator", () => {
	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	describe("withRetry", () => {
		it("should not retry on success", async () => {
			let callCount = 0
			class TestClass {
				@withRetry()
				async *successMethod() {
					callCount++
					yield "success"
				}
			}

			const test = new TestClass()
			const result = []
			for await (const value of test.successMethod()) {
				result.push(value)
			}

			callCount.should.equal(1)
			result.should.deepEqual(["success"])
		})

		it("should retry on rate limit (429) error", async () => {
			let callCount = 0
			class TestClass {
				@withRetry({ maxRetries: 2, baseDelay: 10, maxDelay: 100 })
				async *failMethod() {
					callCount++
					if (callCount === 1) {
						const error: any = new Error("Rate limit exceeded")
						error.status = 429
						throw error
					}
					yield "success after retry"
				}
			}

			const test = new TestClass()
			const result = []
			for await (const value of test.failMethod()) {
				result.push(value)
			}

			;(callCount as any).should.equal(2)
			result.should.deepEqual(["success after retry"])
		})

		it("reports retry attempts through ApiHandlerContext", async () => {
			let callCount = 0
			const onRetryAttempt = vi.fn()
			class TestClass {
				ctx = { onRetryAttempt }

				@withRetry({ maxRetries: 2, baseDelay: 1 })
				async *failMethod() {
					callCount++
					if (callCount === 1) {
						const error: any = new Error("Rate limit exceeded")
						error.status = 429
						throw error
					}
					yield "success"
				}
			}

			for await (const _ of new TestClass().failMethod()) {
				// consume generator
			}

			onRetryAttempt.mock.calls.length.should.equal(1)
			onRetryAttempt.mock.calls[0][0].should.equal(1)
			onRetryAttempt.mock.calls[0][1].should.equal(2)
		})

		it("should not retry on non-rate-limit errors", async () => {
			let callCount = 0
			class TestClass {
				@withRetry()
				async *failMethod() {
					callCount++
					throw new Error("Regular error")
				}
			}

			const test = new TestClass()
			try {
				for await (const _ of test.failMethod()) {
					// Should not reach here
				}
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.equal("Regular error")
				callCount.should.equal(1)
			}
		})

		it("should respect retry-after header with delta seconds", async () => {
			let callCount = 0
			const setTimeoutSpy = vi.spyOn(global, "setTimeout")
			const baseDelay = 1000

			class TestClass {
				@withRetry({ maxRetries: 2, baseDelay }) // Use large baseDelay to ensure header takes precedence
				async *failMethod() {
					callCount++
					if (callCount === 1) {
						const error: any = new Error("Rate limit exceeded")
						error.status = 429
						error.headers = { "retry-after": "0.01" } // 10ms delay
						throw error
					}
					yield "success after retry"
				}
			}

			const test = new TestClass()
			const result = []
			for await (const value of test.failMethod()) {
				result.push(value)
			}

			;(callCount as any).should.equal(2)
			setTimeoutSpy.mock.calls.length.should.equal(1)
			const [_, delay] = setTimeoutSpy.mock.calls[0]
			delay?.should.equal(0)

			result.should.deepEqual(["success after retry"])
		})

		it("should respect retry-after header with Unix timestamp", async () => {
			const fixedDate = new Date("2010-01-01T00:00:00.000Z")
			vi.spyOn(Date, "now").mockReturnValue(fixedDate.getTime())
			const setTimeoutSpy = vi.spyOn(global, "setTimeout").mockImplementation(((callback: (...args: any[]) => void) => {
				queueMicrotask(callback)
				return {} as NodeJS.Timeout
			}) as typeof setTimeout)
			let callCount = 0
			const retryTimestamp = Math.floor(fixedDate.getTime() / 1000) + 1
			const baseDelay = 1000

			class TestClass {
				@withRetry({ maxRetries: 2, baseDelay }) // Use large baseDelay to ensure header takes precedence
				async *failMethod() {
					callCount++
					if (callCount === 1) {
						const error: any = new Error("Rate limit exceeded")
						error.status = 429
						error.headers = { "retry-after": retryTimestamp.toString() }
						throw error
					}
					yield "success after retry"
				}
			}

			const result = []
			for await (const value of new TestClass().failMethod()) result.push(value)

			;(callCount as any).should.equal(2)
			setTimeoutSpy.mock.calls.length.should.equal(1)
			const [_, delay] = setTimeoutSpy.mock.calls[0]
			delay?.should.equal(1_000)

			result.should.deepEqual(["success after retry"])
		})

		it("should use exponential backoff when no retry-after header", async () => {
			const setTimeoutSpy = vi.spyOn(global, "setTimeout")
			let callCount = 0
			const baseDelay = 10

			class TestClass {
				@withRetry({ maxRetries: 2, baseDelay, maxDelay: 100 })
				async *failMethod() {
					callCount++
					if (callCount === 1) {
						const error: any = new Error("Rate limit exceeded")
						error.status = 429
						throw error
					}
					yield "success after retry"
				}
			}

			const test = new TestClass()
			const result = []
			for await (const value of test.failMethod()) {
				result.push(value)
			}

			;(callCount as any).should.equal(2)
			setTimeoutSpy.mock.calls.length.should.equal(1)
			const [_, delay] = setTimeoutSpy.mock.calls[0]
			delay?.should.equal(baseDelay)

			result.should.deepEqual(["success after retry"])
		})

		it("should respect maxDelay", async () => {
			const setTimeoutSpy = vi.spyOn(global, "setTimeout")
			let callCount = 0
			const baseDelay = 50
			const maxDelay = 10

			class TestClass {
				@withRetry({ maxRetries: 3, baseDelay, maxDelay })
				async *failMethod() {
					callCount++
					if (callCount < 3) {
						const error: any = new Error("Rate limit exceeded")
						error.status = 429
						throw error
					}
					yield "success after retries"
				}
			}

			const test = new TestClass()
			const result = []
			for await (const value of test.failMethod()) {
				result.push(value)
			}

			;(callCount as any).should.equal(3)
			setTimeoutSpy.mock.calls.length.should.equal(2)
			setTimeoutSpy.mock.calls.map(([, delay]) => delay).should.deepEqual([maxDelay, maxDelay])

			result.should.deepEqual(["success after retries"])
		})

		it("should throw after maxRetries attempts", async () => {
			let callCount = 0
			class TestClass {
				@withRetry({ maxRetries: 2, baseDelay: 10 })
				async *failMethod() {
					callCount++
					const error: any = new Error("Rate limit exceeded")
					error.status = 429
					throw error
				}
			}

			const test = new TestClass()
			try {
				for await (const _ of test.failMethod()) {
					// Should not reach here
				}
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.equal("Rate limit exceeded")
				;(callCount as any).should.equal(2) // Initial attempt + 1 retry
			}
		})
	})
})
