import { describe, expect, it } from "vitest";
import {
    DLINE_ENVIRONMENT_ENV,
    DLINE_ENVIRONMENT_OVERRIDE_ENV,
    DLINE_ENVIRONMENTS,
    DEFAULT_DLINE_ENVIRONMENT,
    getClineEnvironmentConfig,
    resolveClineEnvironment,
} from "./cline-environment";

describe("resolveClineEnvironment", () => {
	it("defaults to production when no env var is set", () => {
		expect(resolveClineEnvironment({ env: {} })).toBe("production");
	});

	it("reads DLINE_ENVIRONMENT", () => {
		expect(
			resolveClineEnvironment({
				env: { [DLINE_ENVIRONMENT_ENV]: "staging" },
			}),
		).toBe("staging");
		expect(
			resolveClineEnvironment({
				env: { [DLINE_ENVIRONMENT_ENV]: "local" },
			}),
		).toBe("local");
	});

	it("prefers DLINE_ENVIRONMENT_OVERRIDE over DLINE_ENVIRONMENT", () => {
		expect(
			resolveClineEnvironment({
				env: {
					[DLINE_ENVIRONMENT_OVERRIDE_ENV]: "local",
					[DLINE_ENVIRONMENT_ENV]: "staging",
				},
			}),
		).toBe("local");
	});

	it("normalizes case and surrounding whitespace", () => {
		expect(
			resolveClineEnvironment({
				env: { [DLINE_ENVIRONMENT_ENV]: "  STAGING  " },
			}),
		).toBe("staging");
	});

	it("ignores unknown values and falls through to the next source", () => {
		expect(
			resolveClineEnvironment({
				env: {
					[DLINE_ENVIRONMENT_OVERRIDE_ENV]: "qa",
					[DLINE_ENVIRONMENT_ENV]: "staging",
				},
			}),
		).toBe("staging");

		expect(
			resolveClineEnvironment({
				env: { [DLINE_ENVIRONMENT_ENV]: "qa" },
			}),
		).toBe(DEFAULT_DLINE_ENVIRONMENT);
	});
});

describe("getClineEnvironmentConfig", () => {
	it("returns the config for an explicit environment", () => {
		expect(getClineEnvironmentConfig("staging")).toBe(
			DLINE_ENVIRONMENTS.staging,
		);
		expect(getClineEnvironmentConfig("local")).toBe(DLINE_ENVIRONMENTS.local);
		expect(getClineEnvironmentConfig("production")).toBe(
			DLINE_ENVIRONMENTS.production,
		);
	});

	it("resolves from env when no explicit environment is passed", () => {
		expect(
			getClineEnvironmentConfig({
				env: { [DLINE_ENVIRONMENT_ENV]: "staging" },
			}),
		).toBe(DLINE_ENVIRONMENTS.staging);
	});

	it("falls back to production by default", () => {
		expect(getClineEnvironmentConfig({ env: {} })).toBe(
			DLINE_ENVIRONMENTS.production,
		);
	});
});

describe("DLINE_ENVIRONMENTS catalog", () => {
	it("exposes an environment field that matches its key", () => {
		for (const [key, config] of Object.entries(DLINE_ENVIRONMENTS)) {
			expect(config.environment).toBe(key);
		}
	});

	it("populates appBaseUrl, apiBaseUrl, and mcpBaseUrl for every environment", () => {
		for (const config of Object.values(DLINE_ENVIRONMENTS)) {
			expect(config.appBaseUrl).toMatch(/^https?:\/\//);
			expect(config.apiBaseUrl).toMatch(/^https?:\/\//);
			expect(config.mcpBaseUrl).toMatch(/^https?:\/\//);
		}
	});
});
