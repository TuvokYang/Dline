import { getDlineDocumentsPathSync } from "@core/storage/disk"
import path from "path"
import { ArtifactResolver, type ArtifactResolverOptions } from "./ArtifactResolver"
import { SecureArtifactUrlDownloader } from "./SecureArtifactUrlDownloader"
import { TaskArtifactStore } from "./TaskArtifactStore"
import { TaskImagePreviewStore } from "./TaskImagePreviewStore"

export function getTaskArtifactDirectory(taskId: string): string {
	return path.join(getDlineDocumentsPathSync(), "tasks", taskId)
}

export function createTaskArtifactStore(taskId: string): TaskArtifactStore {
	return new TaskArtifactStore({ taskDirectory: getTaskArtifactDirectory(taskId), taskId })
}

export function createTaskImagePreviewStore(taskId: string): TaskImagePreviewStore {
	return new TaskImagePreviewStore(getTaskArtifactDirectory(taskId))
}

export function createTaskArtifactResolver(taskId: string, options: ArtifactResolverOptions = {}): ArtifactResolver {
	return new ArtifactResolver(createTaskArtifactStore(taskId), {
		...options,
		urlDownloader: options.urlDownloader ?? new SecureArtifactUrlDownloader(),
	})
}
