const prompts: Record<string, string> = {
	standardDescription:
		"Generate or edit images through the configured Current, Independent, or Hosted image source. This is the only AI-callable image generation entry point and is a paid external operation. Choose output size, quality, format, compression, and background explicitly when the user requests them. Outputs are stored as task artifacts; the tool result contains artifact IDs and safe metadata, never full base64 image data.",
	promptInstruction: "Describe the image to generate or the edit to apply.",
	profileInstruction: "Optional name or ID of the currently bound Image profile. This cannot switch to unrelated credentials.",
	countInstruction: "Number of images to generate. Must be a positive integer within the model and task limits.",
	widthInstruction:
		"Optional desired output width in pixels. Provide height together with width. The selected image model may map it to the closest supported output. Omit both for the default 16:9 target around 2048×1152.",
	heightInstruction:
		"Optional desired output height in pixels. Provide width together with height. The selected image model may map it to the closest supported output. Omit both for the default 16:9 target around 2048×1152.",
	aspectRatioInstruction:
		"Optional desired aspect ratio. The selected image model maps it to a supported output ratio.",
	qualityInstruction: "Optional quality: auto, low, medium, or high. Defaults to auto.",
	backgroundInstruction: "Optional background mode: auto, opaque, or transparent. Transparent output requires PNG or WebP.",
	outputFormatInstruction: "Optional output format: png, jpeg, or webp. Defaults to png.",
	outputCompressionInstruction: "Optional integer compression level from 0 to 100. Only valid for JPEG and WebP output.",
	referenceArtifactIdsInstruction: "Optional JSON array of task image Artifact IDs to use as references.",
	maskArtifactIdInstruction: "Optional task image Artifact ID to use as an edit mask.",
}

export default prompts
