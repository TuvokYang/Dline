import { describe, expect, it } from "vitest"
import { normalizeRuntimeError } from "../error-normalizer"

describe("normalizeRuntimeError fingerprint masking", () => {
	it("masks every volatile number in one message", () => {
		const first = normalizeRuntimeError(new Error("task 1788537591853 failed after 3200ms"))
		const second = normalizeRuntimeError(new Error("task 1788538925641 failed after 5100ms"))

		expect(first.fingerprint).toContain("task * failed after *ms")
		expect(first.fingerprint).toBe(second.fingerprint)
	})

	it("masks uuids", () => {
		const first = normalizeRuntimeError(new Error("session 3f2504e0-4f89-11d3-9a0c-0305e82c3301 expired"))
		const second = normalizeRuntimeError(new Error("session 8a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9 expired"))

		expect(first.fingerprint).toBe(second.fingerprint)
	})

	it("stays stable across repeated calls", () => {
		const message = "port 8080 refused after 3 attempts"
		const first = normalizeRuntimeError(new Error(message))
		const second = normalizeRuntimeError(new Error(message))

		expect(first.fingerprint).toBe(second.fingerprint)
	})
})

describe("normalizeRuntimeError identity", () => {
	it("keeps code and status from an HTTP-style error", () => {
		const normalized = normalizeRuntimeError(
			Object.assign(new Error("Request failed with status code 503"), {
				code: "ERR_BAD_RESPONSE",
				status: 503,
			}),
		)

		expect(normalized.code).toBe("ERR_BAD_RESPONSE")
		expect(normalized.status).toBe(503)
	})

	it("reads status from statusCode when status is absent", () => {
		const normalized = normalizeRuntimeError(Object.assign(new Error("gateway timeout"), { statusCode: 504 }))

		expect(normalized.status).toBe(504)
	})

	it("normalizes a bounded cause chain", () => {
		const root = new Error("socket hang up")
		const middle = new Error("request failed", { cause: root })
		const outer = new Error("model call failed", { cause: middle })

		const normalized = normalizeRuntimeError(outer)

		expect(normalized.cause?.message).toBe("request failed")
		expect(normalized.cause?.cause?.message).toBe("socket hang up")
	})

	it("labels a thrown non-error value", () => {
		const normalized = normalizeRuntimeError(42)

		expect(normalized.name).toBe("NonError")
		expect(normalized.message).toBe("42")
	})

	it("redacts credentials interpolated into the message", () => {
		const normalized = normalizeRuntimeError(new Error("rejected: Authorization: Bearer sk-live-123"))

		expect(normalized.message).not.toContain("sk-live-123")
		expect(normalized.message).toContain("Bearer [REDACTED]")
	})
})
