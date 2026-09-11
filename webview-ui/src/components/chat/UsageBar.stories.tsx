import type { AccountUsageData } from "@shared/ExtensionMessage"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { createStorybookDecorator } from "@/config/StorybookDecorator"
import { UsageBar } from "./UsageBar"

const accountUsage: AccountUsageData = {
	profileId: "profile-story",
	providerId: "openai-codex",
	currency: "",
	planType: "plus",
	quotas: [
		{
			type: "5hour",
			label: "5 hour",
			used: 20,
			limit: 100,
			resetAt: "2030-01-01T12:00:00.000Z",
		},
		{
			type: "weekly",
			label: "7 day",
			used: 83,
			limit: 100,
			resetAt: "2030-01-07T12:00:00.000Z",
		},
	],
	resetCreditsAvailableCount: 2,
	resetCredits: [
		{ id: "credit-story-1", expiresAt: "2030-03-25T00:00:00.000Z" },
		{ id: "credit-story-2", expiresAt: "2030-04-02T00:00:00.000Z" },
	],
}

function UsageBarFixture() {
	return (
		<div className="flex h-[520px] w-full items-end justify-end p-6" data-testid="usage-bar-fixture">
			<UsageBar />
		</div>
	)
}

const meta = {
	title: "Chat/UsageBar",
	component: UsageBarFixture,
	parameters: {
		layout: "fullscreen",
	},
	decorators: [createStorybookDecorator({ accountUsage }, "w-full max-w-none")],
} satisfies Meta<typeof UsageBarFixture>

export default meta
type Story = StoryObj<typeof meta>

export const RemainingCapacity: Story = {}
