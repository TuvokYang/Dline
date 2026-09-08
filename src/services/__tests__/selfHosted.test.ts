/**
 * Tests for selfHosted mode behavior across PostHog-based services.
 * When ClineEndpoint.isSelfHosted() returns true, all PostHog functionality should be disabled.
 */

import { afterEach, describe, it, vi } from "vitest"
import * as assert from "assert"
// sinon import removed

// Mock the missing generated module to prevent import chain failure
vi.mock("@generated/hosts/vscode/protobus-services", () => ({
	serviceHandlers: {},
}))

import { ClineEndpoint } from "@/config"
import { ErrorProviderFactory } from "../error/ErrorProviderFactory"
import { FeatureFlagsProviderFactory } from "../feature-flags/FeatureFlagsProviderFactory"

describe("SelfHosted Mode - PostHog Disabling", () => {
	let isSelfHostedStub: any /* sinon.SinonStub → vitest */

	afterEach(() => {
		if (isSelfHostedStub) {
			isSelfHostedStub.mockRestore()
		}
	})

	describe("FeatureFlagsProviderFactory", () => {
		// Experimental switches are resolved locally, so self-hosted mode has
		// nothing to disable: there is no request to suppress either way.
		it("should resolve locally regardless of selfHosted mode", () => {
			isSelfHostedStub = vi.spyOn(ClineEndpoint, "isSelfHosted").mockReturnValue(true)
			assert.strictEqual(FeatureFlagsProviderFactory.getDefaultConfig().type, "local")

			isSelfHostedStub.mockReturnValue(false)
			assert.strictEqual(FeatureFlagsProviderFactory.getDefaultConfig().type, "local")
		})

		it("should create a provider that reports as enabled", () => {
			const config = FeatureFlagsProviderFactory.getDefaultConfig()
			const provider = FeatureFlagsProviderFactory.createProvider(config)

			assert.strictEqual(provider.isEnabled(), true)
		})
	})

	describe("ErrorProviderFactory", () => {
		it("should return no-op config when in selfHosted mode", () => {
			isSelfHostedStub = vi.spyOn(ClineEndpoint, "isSelfHosted").mockReturnValue(true)

			const config = ErrorProviderFactory.getDefaultConfig()

			assert.strictEqual(config.type, "no-op", "Should return no-op type in selfHosted mode")
		})

		it("should return posthog config when NOT in selfHosted mode", () => {
			isSelfHostedStub = vi.spyOn(ClineEndpoint, "isSelfHosted").mockReturnValue(false)

			const config = ErrorProviderFactory.getDefaultConfig()

			assert.strictEqual(config.type, "posthog", "Should return posthog type when not in selfHosted mode")
		})

		it("should create NoOp provider when in selfHosted mode", async () => {
			isSelfHostedStub = vi.spyOn(ClineEndpoint, "isSelfHosted").mockReturnValue(true)

			const config = ErrorProviderFactory.getDefaultConfig()
			const provider = await ErrorProviderFactory.createProvider(config)

			// NoOp provider should always be enabled
			assert.strictEqual(provider.isEnabled(), true, "NoOp provider should report as enabled")

			await provider.dispose()
		})
	})

	describe("Integration - selfHosted should disable all PostHog services", () => {
		it("should return no-op for every PostHog-based factory when selfHosted", () => {
			isSelfHostedStub = vi.spyOn(ClineEndpoint, "isSelfHosted").mockReturnValue(true)

			// Feature flags are no longer PostHog-based, so they are not part of
			// this assertion: local resolution makes no request to suppress.
			assert.strictEqual(ErrorProviderFactory.getDefaultConfig().type, "no-op", "Error provider should be no-op")
		})
	})
})
