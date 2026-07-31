import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ApiErrorBox } from "./ApiErrorBox"

describe("ApiErrorBox", () => {
	it("renders structured provider error fields without exposing the serialized payload", () => {
		const serializedError = JSON.stringify({
			message: "500 No scripted E2E response remains for openai-compatible-chat",
			status: 500,
			request_id: "req_e2e_123",
			code: "e2e_mock_queue_exhausted",
			modelId: "dline-e2e-model",
			providerId: "openai",
			details: {
				message: "No scripted E2E response remains for openai-compatible-chat",
				type: "e2e_mock_error",
				code: "e2e_mock_queue_exhausted",
				retry_after: 2,
			},
		})

		const { container } = render(<ApiErrorBox error={serializedError} />)

		expect(screen.getByTestId("api-error-box-provider")).toHaveTextContent("openai")
		expect(screen.getByTestId("api-error-box-model")).toHaveTextContent("dline-e2e-model")
		expect(screen.getByTestId("api-error-box-status")).toHaveTextContent("500")
		expect(screen.getByTestId("api-error-box-code")).toHaveTextContent("e2e_mock_queue_exhausted")
		expect(screen.getByTestId("api-error-box-request-id")).toHaveTextContent("req_e2e_123")
		expect(screen.getByTestId("api-error-box-message")).toHaveTextContent(
			"No scripted E2E response remains for openai-compatible-chat",
		)
		expect(screen.getByTestId("api-error-box-detail-type")).toHaveTextContent("e2e_mock_error")
		expect(screen.getByTestId("api-error-box-detail-retry-after")).toHaveTextContent("2")
		expect(screen.getAllByText("e2e_mock_queue_exhausted")).toHaveLength(1)
		expect(container).not.toHaveTextContent(serializedError)
	})

	it("renders provider and model for an error without status or code", () => {
		const serializedError = JSON.stringify({
			message: "Connection error.",
			modelId: "claude-sonnet-4-6",
			providerId: "anthropic",
		})

		render(<ApiErrorBox error={serializedError} />)

		expect(screen.getByTestId("api-error-box-provider")).toHaveTextContent("anthropic")
		expect(screen.getByTestId("api-error-box-model")).toHaveTextContent("claude-sonnet-4-6")
		expect(screen.getByTestId("api-error-box-message")).toHaveTextContent("Connection error.")
		expect(screen.queryByTestId("api-error-box-status")).not.toBeInTheDocument()
		expect(screen.queryByTestId("api-error-box-code")).not.toBeInTheDocument()
	})

	it("renders a plain error message without manufacturing metadata", () => {
		render(<ApiErrorBox error="Command failed" title="Error" />)

		expect(screen.getByText("Error")).toBeInTheDocument()
		expect(screen.getByTestId("api-error-box-message")).toHaveTextContent("Command failed")
		expect(screen.queryByTestId("api-error-box-provider")).not.toBeInTheDocument()
	})
})
