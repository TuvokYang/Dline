const prompts: Record<string, string> = {
	standardDescription:
		"Generate or edit images through the configured Image provider. This is a paid external operation. Outputs are stored as task artifacts; the tool result contains artifact IDs and safe metadata, never full base64 image data. Use provider-neutral parameters only.",
	promptInstruction: "Describe the image to generate or the edit to apply.",
	profileInstruction: "Optional Image profile name or ID. Omit it to use the configured default resolution order.",
	countInstruction: "Number of images to generate. Must be a positive integer within the model and task limits.",
	widthInstruction: "Optional output width in pixels. Provide height together with width.",
	heightInstruction: "Optional output height in pixels. Provide width together with height.",
	aspectRatioInstruction: "Optional provider-neutral aspect ratio such as 1:1, 16:9, or 9:16.",
	qualityInstruction: "Optional provider-neutral quality preset supported by the selected image model.",
	backgroundInstruction: "Optional background mode: auto, opaque, or transparent.",
	outputFormatInstruction: "Optional output format: png, jpeg, or webp.",
	referenceArtifactIdsInstruction: "Optional JSON array of task image Artifact IDs to use as references.",
	maskArtifactIdInstruction: "Optional task image Artifact ID to use as an edit mask.",
}

export default prompts
