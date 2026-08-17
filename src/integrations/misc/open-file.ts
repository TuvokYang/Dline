import { existsSync } from "node:fs"
import { writeFile } from "@utils/fs"
import * as os from "os"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/dline/host/window"

export async function openImage(dataUri: string) {
	const matches = dataUri.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/)
	if (!matches) {
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: "Invalid data URI format",
		})
		return
	}
	const [, format, base64Data] = matches
	const imageBuffer = Buffer.from(base64Data, "base64")
	const tempFilePath = path.join(os.tmpdir(), `temp_image_${Date.now()}.${format}`)
	try {
		await writeFile(tempFilePath, new Uint8Array(imageBuffer))
		await HostProvider.window.openFile({
			filePath: tempFilePath,
		})
	} catch (error) {
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: `Error opening image: ${error}`,
		})
	}
}

/**
 * File extensions opened through the generic `vscode.open` command because
 * the text editor cannot display them (binary/media/document files).
 */
const GENERIC_OPEN_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".webp",
	".gif",
	".bmp",
	".svg",
	".ico",
	".pdf",
	".doc",
	".docx",
	".xls",
	".xlsx",
	".ppt",
	".pptx",
	".zip",
	".gz",
	".tar",
])

/**
 * Decides whether a file should be opened through the generic open command
 * instead of the text editor. Text files stay on the text editor path so
 * line-number selection keeps working.
 */
export function shouldOpenViaGenericCommand(absolutePath: string): boolean {
	const extension = path.extname(absolutePath).toLowerCase()
	return GENERIC_OPEN_EXTENSIONS.has(extension)
}

export async function openFile(absolutePath: string, preserveFocus = false, preview = false, lineNumber?: number) {
	try {
		if (!existsSync(absolutePath)) {
			return
		}
		if (shouldOpenViaGenericCommand(absolutePath)) {
			await HostProvider.window.openFile({ filePath: absolutePath })
			return
		}
		const options: Record<string, unknown> = {
			preserveFocus: lineNumber ? true : preserveFocus,
			preview,
		}
		if (lineNumber && lineNumber > 0) {
			options.selection = { start: { line: lineNumber - 1, character: 0 }, end: { line: lineNumber - 1, character: 0 } }
		}
		await HostProvider.window.showTextDocument({
			path: absolutePath,
			options,
		})
	} catch (_error) {
		HostProvider.window.showMessage({
			type: ShowMessageType.ERROR,
			message: `Could not open file!`,
		})
	}
}
