import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, type Frame } from "@playwright/test"
import { ImageGenerationSource } from "../../shared/proto/dline/profile"
import { E2E_PROFILE_NAMES } from "./utils/api-profile"
import { E2ETestHelper, e2e } from "./utils/helpers"

const PNG_1X1_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="

async function updateSettings(dlineDir: string, updates: Record<string, unknown>): Promise<void> {
	const filePath = path.join(dlineDir, "data", "settings", "settings.json")
	const settings = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>
	await writeFile(filePath, `${JSON.stringify({ ...settings, ...updates }, null, 2)}\n`, "utf8")
}

async function configureHostedCapableImageProfile(dlineDir: string): Promise<void> {
	const settingsDir = path.join(dlineDir, "data", "settings")
	const profilesPath = path.join(settingsDir, "api_profiles.json")
	const profiles = JSON.parse(await readFile(profilesPath, "utf8")) as Array<Record<string, unknown>>
	const profile = profiles.find((candidate) => candidate.name === E2E_PROFILE_NAMES.mockOpenAiResponses)
	if (!profile) throw new Error("Hosted image E2E profile is unavailable")
	profile.imageSource = "IMAGE_GENERATION_SOURCE_CURRENT"
	delete profile.imageProfileId
	delete profile.imageModelId
	await writeFile(profilesPath, `${JSON.stringify(profiles, null, 2)}\n`, "utf8")
	await writeFile(path.join(settingsDir, "image_generation_profiles.json"), "[]\n", "utf8")
	await updateSettings(dlineDir, {
		actModeProfile: E2E_PROFILE_NAMES.mockOpenAiResponses,
		planModeProfile: E2E_PROFILE_NAMES.mockOpenAiResponses,
		imageGenerationEnabled: true,
		clineWebToolsEnabled: false,
	})
}

async function setGenerateImagesAutoApproval(sidebar: Frame): Promise<void> {
	await sidebar.getByLabel("Open auto-approve settings").click()
	const checkbox = sidebar.locator("vscode-checkbox").filter({ hasText: "Generate images" })
	await expect(checkbox).toHaveCount(1)
	const isChecked = () => checkbox.evaluate((element) => Boolean((element as HTMLInputElement).checked))
	if (!(await isChecked())) await sidebar.getByText("Generate images", { exact: true }).click()
	await expect.poll(isChecked).toBe(true)
	await sidebar.getByLabel("Close auto-approve settings").click()
}

async function sendTask(sidebar: Frame, text: string): Promise<void> {
	await sidebar.getByTestId("chat-input").fill(text)
	await sidebar.getByTestId("send-button").click()
	await expect(sidebar.getByText(text, { exact: true }).first()).toBeVisible()
}

async function findFiles(root: string, fileName: string): Promise<string[]> {
	const matches: string[] = []
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const entryPath = path.join(root, entry.name)
		if (entry.isDirectory()) matches.push(...(await findFiles(entryPath, fileName)))
		else if (entry.name === fileName) matches.push(entryPath)
	}
	return matches
}

e2e("Image generation - Feature off keeps generate_image out of the provider tool schema", async ({
	dlineDir,
	helper,
	openVSCode,
	server,
	userDataDir,
	workspaceDir,
}) => {
	e2e.setTimeout(120_000)
	server.resetOpenAiMock()
	server.enqueueOpenAiResponses({
		type: "tool",
		id: "call_image_gate_off_completion",
		name: "attempt_completion",
		arguments: { result: "E2E_IMAGE_GATE_OFF_OK" },
		expectedRequestExcludes: ['"generate_image"'],
	})

	const app = await openVSCode(workspaceDir)
	try {
		const page = await app.firstWindow()
		await E2ETestHelper.openClineSidebar(page)
		const sidebar = await helper.getSidebar(page)
		await helper.signin(sidebar)
		await sendTask(sidebar, "Complete without generating an image while the Image Generation feature is disabled.")
		await expect(sidebar.getByText("E2E_IMAGE_GATE_OFF_OK", { exact: false }).last()).toBeVisible({ timeout: 60_000 })

		const consumptions = server.getMockConsumptions("openai-compatible-chat")
		expect(consumptions).toHaveLength(1)
		expect(consumptions[0].contractError).toBeUndefined()
		expect(JSON.stringify(consumptions[0].requestBody)).not.toContain("generate_image")
		expect(server.getOpenAIImageConsumptions()).toHaveLength(0)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	} finally {
		await app.close()
	}
})

	e2e("Image generation - custom OpenAI Responses Hosted persists UI selection and a safe Artifact", async ({
		dlineDir,
		dlineDocsDir,
		helper,
		openVSCode,
		server,
		userDataDir,
		workspaceDir,
	}, testInfo) => {
	e2e.setTimeout(180_000)
	await configureHostedCapableImageProfile(dlineDir)
	server.resetOpenAiMock()
	server.enqueueResponses("openai-compatible-responses", {
		type: "hosted-image-generation",
		id: "ig_hosted_e2e",
		b64Json: PNG_1X1_BASE64,
		revisedPrompt: "A hosted deterministic blue owl",
		followupTools: [
			{ id: "call_hosted_image_done", name: "attempt_completion", arguments: { result: "E2E_HOSTED_IMAGE_OK" } },
		],
		expectedRequestIncludes: ['"type":"image_generation"'],
		expectedRequestExcludes: ['"generate_image"'],
	})

	const app = await openVSCode(workspaceDir)
	try {
		const page = await app.firstWindow()
		await E2ETestHelper.openClineSidebar(page)
		const sidebar = await helper.getSidebar(page)
		await helper.signin(sidebar)
		await page.getByRole("button", { name: "Settings", exact: true }).click()
		await expect(sidebar.getByRole("heading", { name: "API Configuration" })).toBeVisible()
		await sidebar
			.getByRole("button", { name: `Expand ${E2E_PROFILE_NAMES.mockOpenAiResponses}`, exact: true })
			.click()
		const profileCard = sidebar
			.getByTestId("api-profile-card")
			.filter({ has: sidebar.locator(`input[value="${E2E_PROFILE_NAMES.mockOpenAiResponses}"]`) })
		await expect(profileCard).toHaveCount(1)
		const imageSource = profileCard.getByRole("combobox", { name: "Image source", exact: true })
		await expect(imageSource).toBeVisible()
		await expect(imageSource.getByRole("option", { name: "Independent", exact: true })).toHaveCount(0)
		await expect(imageSource.getByRole("option", { name: "Hosted", exact: true })).toBeEnabled()
		await imageSource.selectOption({ label: "Hosted" })
		await expect(imageSource).toHaveValue(String(ImageGenerationSource.IMAGE_GENERATION_SOURCE_HOSTED))
		const profilesPath = path.join(dlineDir, "data", "settings", "api_profiles.json")
		await E2ETestHelper.waitUntil(async () => {
			const profiles = JSON.parse(await readFile(profilesPath, "utf8")) as Array<Record<string, unknown>>
			return profiles.some(
				(profile) =>
					profile.name === E2E_PROFILE_NAMES.mockOpenAiResponses &&
					profile.imageSource === "IMAGE_GENERATION_SOURCE_HOSTED",
			)
		})
		const persistedProfiles = JSON.parse(await readFile(profilesPath, "utf8")) as Array<Record<string, unknown>>
		const persistedProfile = persistedProfiles.find(
			(profile) => profile.name === E2E_PROFILE_NAMES.mockOpenAiResponses,
		)
		expect(persistedProfile).toMatchObject({
			imageSource: "IMAGE_GENERATION_SOURCE_HOSTED",
		})
		expect(persistedProfile?.usedFor).not.toContain("image")
		expect(persistedProfile).not.toHaveProperty("imageProfileId")
		expect(persistedProfile).not.toHaveProperty("imageModelId")
		const proofDir = path.join(process.cwd(), "tmp", "e2e-proof", "ws009-hosted-storage-proof")
		const screenshotPath = path.join(proofDir, "hosted-image-source-selected.png")
		const persistedProofPath = path.join(proofDir, "hosted-image-source-persisted.json")
		await mkdir(proofDir, { recursive: true })
		await profileCard.screenshot({ path: screenshotPath })
		await writeFile(
			persistedProofPath,
			`${JSON.stringify(
				{
					id: persistedProfile?.id,
					name: persistedProfile?.name,
					usedFor: persistedProfile?.usedFor,
					imageSource: persistedProfile?.imageSource,
					imageProfileId: persistedProfile?.imageProfileId,
					imageModelId: persistedProfile?.imageModelId,
				},
				null,
				2,
			)}\n`,
			"utf8",
		)
		await testInfo.attach("hosted-image-source-selected.png", { path: screenshotPath, contentType: "image/png" })
		await testInfo.attach("hosted-image-source-persisted.json", {
			path: persistedProofPath,
			contentType: "application/json",
		})
		await sidebar.getByRole("button", { name: "Done", exact: true }).click()
		await expect(sidebar.getByTestId("chat-input")).toBeVisible()
		await sendTask(sidebar, "Generate one image with OpenAI Responses Hosted and complete.")

		await expect(sidebar.getByText("Image generation completed", { exact: true }).last()).toBeVisible({ timeout: 60_000 })
		await expect(sidebar.getByRole("img", { name: "Generated image 1" }).last()).toBeVisible({ timeout: 30_000 })
		await expect(sidebar.getByText("E2E_HOSTED_IMAGE_OK", { exact: false }).last()).toBeVisible({ timeout: 60_000 })

		const consumptions = server.getMockConsumptions("openai-compatible-responses")
		expect(consumptions).toHaveLength(1)
		expect(consumptions[0].contractError).toBeUndefined()
		expect(JSON.stringify(consumptions[0].requestBody)).toContain('"type":"image_generation"')
		expect(JSON.stringify(consumptions[0].requestBody)).not.toContain("generate_image")
		const manifests = await findFiles(path.join(dlineDocsDir, "tasks"), "manifest.json")
		expect(manifests).toHaveLength(1)
		const manifest = await readFile(manifests[0], "utf8")
		expect(manifest).toContain("image:sha256:")
		expect(manifest).not.toContain(PNG_1X1_BASE64)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	} finally {
		await app.close()
	}
})

e2e("Image generation - native tool persists a safe Artifact and renders it through task-scoped RPC", async ({
	dlineDir,
	dlineDocsDir,
	helper,
	openVSCode,
	server,
	userDataDir,
	workspaceDir,
}) => {
	e2e.setTimeout(180_000)
	await updateSettings(dlineDir, { imageGenerationEnabled: true })
	server.resetOpenAiMock()
	server.enqueueOpenAIImageResponses({ b64Json: PNG_1X1_BASE64, revisedPrompt: "A deterministic blue owl" })
	server.enqueueOpenAiResponses(
		{
			type: "tool",
			id: "call_generate_image",
			name: "generate_image",
			arguments: { prompt: "A deterministic blue owl", count: 1, output_format: "png" },
			expectedRequestIncludes: ['"generate_image"'],
		},
		{
			type: "tool",
			id: "call_image_completion",
			name: "attempt_completion",
			arguments: { result: "E2E_IMAGE_GENERATION_OK" },
			expectedToolResults: [{ callId: "call_generate_image", contentIncludes: "image:sha256:" }],
			expectedRequestExcludes: [PNG_1X1_BASE64, "data:image/"],
		},
	)

	const app = await openVSCode(workspaceDir)
	try {
		const page = await app.firstWindow()
		await E2ETestHelper.openClineSidebar(page)
		const sidebar = await helper.getSidebar(page)
		await helper.signin(sidebar)
		await setGenerateImagesAutoApproval(sidebar)
		await sendTask(sidebar, "Generate one deterministic blue owl image and then complete.")

		await expect(sidebar.getByText("Image generation completed", { exact: true }).last()).toBeVisible({ timeout: 60_000 })
		await expect(sidebar.getByRole("img", { name: "Generated image 1" }).last()).toBeVisible({ timeout: 30_000 })
		await expect(sidebar.getByText("E2E_IMAGE_GENERATION_OK", { exact: false }).last()).toBeVisible({ timeout: 60_000 })

		const chatConsumptions = server.getMockConsumptions("openai-compatible-chat")
		expect(chatConsumptions.map((entry) => entry.toolName)).toEqual(["generate_image", "attempt_completion"])
		expect(chatConsumptions.every((entry) => entry.contractError === undefined)).toBe(true)
		const toolResult = chatConsumptions[1].requestToolResults.find((entry) => entry.callId === "call_generate_image")
		expect(toolResult?.content).toContain("image:sha256:")
		expect(toolResult?.content).not.toContain(PNG_1X1_BASE64)
		expect(toolResult?.content).not.toContain("data:image/")

		const imageConsumptions = server.getOpenAIImageConsumptions()
		expect(imageConsumptions).toHaveLength(1)
		expect(imageConsumptions[0].authorization).toBe("Bearer dline-e2e-api-key")
		expect(imageConsumptions[0].requestBody).toMatchObject({
			model: "gpt-image-2",
			prompt: "A deterministic blue owl",
			size: "auto",
			quality: "auto",
			background: "auto",
		})
		expect(imageConsumptions[0].requestBody).not.toHaveProperty("n")
		expect(imageConsumptions[0].requestBody).not.toHaveProperty("output_format")

		const manifests = await findFiles(path.join(dlineDocsDir, "tasks"), "manifest.json")
		expect(manifests).toHaveLength(1)
		const manifest = await readFile(manifests[0], "utf8")
		expect(manifest).toContain("image:sha256:")
		expect(manifest).not.toContain(PNG_1X1_BASE64)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	} finally {
		await app.close()
	}
})
