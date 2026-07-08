import crypto from "crypto"

/**
 * Compute a stable SHA-256 hash for prompt cache content.
 *
 * @param content Text content to hash.
 * @returns SHA-256 hash with an explicit algorithm prefix.
 */
export function hashPromptContent(content: string): string {
	return `sha256:${crypto.createHash("sha256").update(content, "utf8").digest("hex")}`
}
