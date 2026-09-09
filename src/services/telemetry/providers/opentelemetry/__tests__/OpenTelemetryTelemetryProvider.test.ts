import { InMemoryLogRecordExporter, LoggerProvider, SimpleLogRecordProcessor } from "@opentelemetry/sdk-logs"
import { expect } from "chai"
import { afterEach, beforeEach, describe, it, vi } from "vitest"
// sinon import removed
import type { ClineAccountUserInfo } from "@/services/auth/AuthService"
import * as distinctIdModule from "@/services/logging/distinctId"
import { OpenTelemetryTelemetryProvider } from "../OpenTelemetryTelemetryProvider"

function makeUserInfo(
	overrides: Partial<ClineAccountUserInfo> & { orgOverrides?: Record<string, unknown> } = {},
): ClineAccountUserInfo {
	const { orgOverrides, ...rest } = overrides
	return {
		id: "user-1",
		displayName: "Test User",
		email: "test@example.com",
		createdAt: new Date().toISOString(),
		organizations: [
			{
				active: true,
				memberId: "member-1",
				name: "Org A",
				organizationId: "org-a",
				roles: ["admin"],
				...(orgOverrides ?? {}),
			},
		],
		...rest,
	}
}

describe("OpenTelemetryTelemetryProvider.identifyUser", () => {
	let logExporter: InMemoryLogRecordExporter
	let loggerProvider: LoggerProvider
	let provider: OpenTelemetryTelemetryProvider
	let getDistinctIdStub: any /* sinon.SinonStub → vitest */
	let setDistinctIdStub: any /* sinon.SinonStub → vitest */

	beforeEach(() => {
		logExporter = new InMemoryLogRecordExporter()
		loggerProvider = new LoggerProvider()
		loggerProvider.addLogRecordProcessor(new SimpleLogRecordProcessor(logExporter))

		provider = new OpenTelemetryTelemetryProvider(null, loggerProvider, {
			name: "test-otel",
			bypassUserSettings: true,
		})

		getDistinctIdStub = vi.spyOn(distinctIdModule, "getDistinctId")
		setDistinctIdStub = vi.spyOn(distinctIdModule, "setDistinctId")
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("should emit user_identified log and update distinct ID when ID changes", () => {
		getDistinctIdStub.mockReturnValue("machine-id-123")

		const userInfo = makeUserInfo()
		provider.identifyUser(userInfo)

		// Should have emitted user_identified
		const records = logExporter.getFinishedLogRecords()
		expect(records.length, "Should emit exactly one log record").to.equal(1)
		expect(records[0].body).to.equal("user_identified")

		// Should include org attributes
		const attrs = records[0].attributes
		expect(attrs.user_id).to.equal("user-1")
		expect(attrs.organization_id).to.equal("org-a")
		expect(attrs.organization_name).to.equal("Org A")
		expect(attrs.member_id).to.equal("member-1")
		expect(attrs.member_role).to.equal("admin")
		expect(attrs.alias).to.equal("machine-id-123")

		// Should update distinct ID
		expect(setDistinctIdStub.mock.calls.length, "Should call setDistinctId once").to.equal(1)
		expect(setDistinctIdStub.mock.calls[0][0], "Should call setDistinctId with user ID").to.equal("user-1")
	})

	it("should refresh userAttributes even when distinct ID already matches (no new identify log)", () => {
		// Simulate: user already identified (distinct ID == user ID)
		getDistinctIdStub.mockReturnValue("user-1")

		const userInfo = makeUserInfo()
		provider.identifyUser(userInfo)

		// Should NOT emit user_identified log
		const records = logExporter.getFinishedLogRecords()
		expect(records.length, "Should not emit identify log when distinct ID matches").to.equal(0)

		// Should NOT call setDistinctId
		expect(setDistinctIdStub.mock.calls.length === 0, "Should not call setDistinctId when ID already matches").to.be.true

		// Now emit a regular log and verify org attributes are present
		provider.log("test_event", { custom: "value" })

		const logRecords = logExporter.getFinishedLogRecords()
		expect(logRecords.length, "Should emit one log record for test_event").to.equal(1)
		expect(logRecords[0].body).to.equal("test_event")

		const attrs = logRecords[0].attributes
		expect(attrs.organization_id, "organization_id should be present in subsequent logs").to.equal("org-a")
		expect(attrs.organization_name, "organization_name should be present").to.equal("Org A")
		expect(attrs.member_id, "member_id should be present").to.equal("member-1")
		expect(attrs.user_id, "user_id should be present").to.equal("user-1")
	})

	it("should refresh org attributes when active org changes (same user ID)", () => {
		// First identification with Org A
		getDistinctIdStub.mockReturnValue("user-1")

		const userInfoOrgA = makeUserInfo()
		provider.identifyUser(userInfoOrgA)

		// Emit a log to capture Org A attributes
		provider.log("event_with_org_a")
		let records = logExporter.getFinishedLogRecords()
		expect(records.length).to.equal(1)
		expect(records[0].attributes.organization_id).to.equal("org-a")
		expect(records[0].attributes.organization_name).to.equal("Org A")

		// Clear exporter for next assertion
		logExporter.reset()

		// Now switch to Org B (same user ID)
		const userInfoOrgB = makeUserInfo({
			orgOverrides: {
				organizationId: "org-b",
				name: "Org B",
				memberId: "member-2",
				roles: ["viewer", "editor"],
			},
		})
		provider.identifyUser(userInfoOrgB)

		// Should NOT emit user_identified (same user ID)
		records = logExporter.getFinishedLogRecords()
		expect(records.length, "Should not emit identify log on org switch with same user ID").to.equal(0)

		// Emit a log and verify Org B attributes
		provider.log("event_with_org_b")
		records = logExporter.getFinishedLogRecords()
		expect(records.length).to.equal(1)
		expect(records[0].attributes.organization_id, "Should reflect new org ID").to.equal("org-b")
		expect(records[0].attributes.organization_name, "Should reflect new org name").to.equal("Org B")
		expect(records[0].attributes.member_id, "Should reflect new member ID").to.equal("member-2")
		expect(records[0].attributes.member_role, "Should reflect new role").to.equal("viewer")
	})

	it("should handle user with no active organization", () => {
		getDistinctIdStub.mockReturnValue("user-1")

		const userInfo: ClineAccountUserInfo = {
			id: "user-1",
			displayName: "Solo User",
			email: "solo@example.com",
			createdAt: new Date().toISOString(),
			organizations: [],
		}
		provider.identifyUser(userInfo)

		// Emit a log and verify no org attributes leak from previous state
		provider.log("event_no_org")
		const records = logExporter.getFinishedLogRecords()
		expect(records.length).to.equal(1)

		const attrs = records[0].attributes
		expect(attrs.user_id).to.equal("user-1")
		expect(attrs.user_name).to.equal("Solo User")
		expect(attrs.organization_id, "organization_id should not be present").to.equal(undefined)
		expect(attrs.organization_name, "organization_name should not be present").to.equal(undefined)
		expect(attrs.member_id, "member_id should not be present").to.equal(undefined)
	})

	it("should clear stale org attributes when switching from org to no-org", () => {
		getDistinctIdStub.mockReturnValue("user-1")

		// First: identify with an org
		provider.identifyUser(makeUserInfo())
		provider.log("with_org")
		let records = logExporter.getFinishedLogRecords()
		expect(records[0].attributes.organization_id).to.equal("org-a")

		logExporter.reset()

		// Second: identify same user but no active org
		const userNoOrg: ClineAccountUserInfo = {
			id: "user-1",
			displayName: "Test User",
			email: "test@example.com",
			createdAt: new Date().toISOString(),
			organizations: [
				{
					active: false,
					memberId: "member-1",
					name: "Org A",
					organizationId: "org-a",
					roles: ["admin"],
				},
			],
		}
		provider.identifyUser(userNoOrg)

		provider.log("without_org")
		records = logExporter.getFinishedLogRecords()
		expect(records.length).to.equal(1)
		expect(records[0].attributes.organization_id, "Stale org_id should be cleared").to.equal(undefined)
		expect(records[0].attributes.organization_name, "Stale org_name should be cleared").to.equal(undefined)
	})

	it("should include additional properties passed to identifyUser", () => {
		getDistinctIdStub.mockReturnValue("machine-id")

		provider.identifyUser(makeUserInfo(), { extension_version: "1.2.3", custom_prop: "hello" })

		// Check the identify log includes the properties
		const records = logExporter.getFinishedLogRecords()
		expect(records.length).to.equal(1)
		expect(records[0].attributes.extension_version).to.equal("1.2.3")
		expect(records[0].attributes.custom_prop).to.equal("hello")
		expect(records[0].attributes.organization_id).to.equal("org-a")
	})
})
