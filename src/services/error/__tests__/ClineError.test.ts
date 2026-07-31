import { describe, it } from "vitest"
import "should"
import { ClineError, ClineErrorType } from "../ClineError"

describe("ClineError", () => {
	it("preserves the request ID exposed by provider SDK errors", () => {
		const err = new ClineError({ message: "Provider failed", requestID: "req_sdk_123" }, "model-1", "openai")

		JSON.parse(err.serialize()).request_id.should.equal("req_sdk_123")
	})

	describe("getErrorType", () => {
		it("should return QuotaExceeded when code is INFERENCE_CAP_ERROR", () => {
			const err = new ClineError({ message: "Inference cap reached", code: "INFERENCE_CAP_ERROR" })
			ClineError.getErrorType(err)?.should.equal(ClineErrorType.QuotaExceeded)
		})
	})
})
