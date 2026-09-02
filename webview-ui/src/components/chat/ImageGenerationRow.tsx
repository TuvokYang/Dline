import type { ImageGenerationPresentationV1 } from "@shared/image-generation"
import { StringRequest } from "@shared/proto/dline/common"
import { ImageArtifactRequest } from "@shared/proto/dline/ui"
import { CheckIcon, CopyIcon, ExternalLinkIcon, ImageIcon, LoaderCircleIcon, PaperclipIcon, TriangleAlertIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { FileServiceClient, UiServiceClient } from "@/services/grpc-client"

interface ImageGenerationRowProps {
	presentation: ImageGenerationPresentationV1
	onAddToInput?: (text: string) => void
}

interface ArtifactPreviewState {
	dataUrl?: string
	error?: string
}

function bytesToBase64(bytes: Uint8Array): string {
	const chunks: string[] = []
	const chunkSize = 0x8000
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		chunks.push(String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))))
	}
	return btoa(chunks.join(""))
}

function statusLabel(status: ImageGenerationPresentationV1["status"]): string {
	switch (status) {
		case "queued":
			return "Image generation queued"
		case "started":
			return "Generating image"
		case "preview":
			return "Image preview"
		case "completed":
			return "Image generation completed"
		case "failed":
			return "Image generation failed"
		case "cancelled":
			return "Image generation cancelled"
	}
}

export default function ImageGenerationRow({ presentation, onAddToInput }: ImageGenerationRowProps) {
	const [previews, setPreviews] = useState<Record<string, ArtifactPreviewState>>({})
	const artifacts = useMemo(() => presentation.artifacts ?? [], [presentation.artifacts])

	useEffect(() => {
		let active = true
		for (const artifact of artifacts) {
			void UiServiceClient.getImageArtifact(ImageArtifactRequest.create({ artifactId: artifact.id }))
				.then((content) => {
					if (!active) return
					const bytes = content.data instanceof Uint8Array ? content.data : new Uint8Array(content.data)
					const dataUrl = `data:${content.mimeType};base64,${bytesToBase64(bytes)}`
					setPreviews((current) => ({ ...current, [artifact.id]: { dataUrl } }))
				})
				.catch((error: unknown) => {
					if (!active) return
					setPreviews((current) => ({
						...current,
						[artifact.id]: { error: error instanceof Error ? error.message : "Failed to load image artifact." },
					}))
				})
		}
		return () => {
			active = false
		}
	}, [artifacts])

	const isRunning = presentation.status === "queued" || presentation.status === "started" || presentation.status === "preview"
	const isFailed = presentation.status === "failed"

	return (
		<div className="rounded-md border border-editor-group-border bg-code overflow-hidden">
			<div className="flex items-center gap-2 px-3 py-2 border-b border-editor-group-border">
				{isRunning ? (
					<LoaderCircleIcon className="size-4 animate-spin" />
				) : isFailed ? (
					<TriangleAlertIcon className="size-4 text-error" />
				) : presentation.status === "completed" ? (
					<CheckIcon className="size-4 text-success" />
				) : (
					<ImageIcon className="size-4" />
				)}
				<span className="font-semibold">{statusLabel(presentation.status)}</span>
			</div>
			<div className="p-3 space-y-3">
				<div className="text-sm whitespace-pre-wrap break-words">{presentation.prompt}</div>
				{presentation.modelId && (
					<div className="text-xs text-description">
						{presentation.providerId ? `${presentation.providerId} · ` : ""}
						{presentation.modelId}
					</div>
				)}
				{presentation.error && <div className="text-sm text-error">{presentation.error.message}</div>}
				{artifacts.length > 0 && (
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						{artifacts.map((artifact, index) => {
							const preview = previews[artifact.id]
							return (
								<div className="rounded border border-input-border overflow-hidden" key={artifact.id}>
									<div className="aspect-square bg-editor flex items-center justify-center">
										{preview?.dataUrl ? (
											<img
												alt={`Generated image ${index + 1}`}
												className="h-full w-full object-contain"
												src={preview.dataUrl}
											/>
										) : preview?.error ? (
											<span className="p-3 text-xs text-error">{preview.error}</span>
										) : (
											<LoaderCircleIcon aria-label={`Loading generated image ${index + 1}`} className="size-5 animate-spin" />
										)}
									</div>
									<div className="p-2 text-xs text-description">
										<div>{`${artifact.width}×${artifact.height} · ${artifact.format.toUpperCase()}`}</div>
										<div className="truncate" title={artifact.id}>{artifact.id}</div>
									</div>
									<div className="flex flex-wrap gap-1 p-2 pt-0">
										<button
											aria-label="Open generated image"
											className="flex items-center gap-1 rounded px-2 py-1 hover:bg-toolbar-hover disabled:opacity-50"
											disabled={!preview?.dataUrl}
											onClick={() => preview?.dataUrl && void FileServiceClient.openImage(StringRequest.create({ value: preview.dataUrl }))}
											type="button">
											<ExternalLinkIcon className="size-3" /> Open
										</button>
										<button
											aria-label="Copy Artifact ID"
											className="flex items-center gap-1 rounded px-2 py-1 hover:bg-toolbar-hover"
											onClick={() => void FileServiceClient.copyToClipboard(StringRequest.create({ value: artifact.id }))}
											type="button">
											<CopyIcon className="size-3" /> Copy ID
										</button>
										<button
											aria-label="Use as Reference"
											className="flex items-center gap-1 rounded px-2 py-1 hover:bg-toolbar-hover disabled:opacity-50"
											disabled={!onAddToInput}
											onClick={() =>
												onAddToInput?.(`Use image artifact ${artifact.id} as a reference for the next image generation.`)
											}
											type="button">
											<PaperclipIcon className="size-3" /> Use as Reference
										</button>
									</div>
								</div>
							)
						})}
					</div>
				)}
			</div>
		</div>
	)
}
