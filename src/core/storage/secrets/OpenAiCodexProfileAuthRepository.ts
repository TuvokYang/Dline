import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { FileLock } from "../backend/jsonl/FileLock"
import { getDlineDataDir } from "../disk"
import { getOpenAiCodexProfileAuthPath } from "./OpenAiCodexProfileAuthPath"

const MINIMUM_VALID_EXPIRY_MS = 1_000_000_000_000
const RENAME_RETRY_DELAYS_MS = [10, 25, 50] as const
const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"])
const KNOWN_CREDENTIAL_KEYS = new Set(["type", "access_token", "refresh_token", "expires", "email", "accountId"])

export interface OpenAiOAuthCredentials {
	type?: string
	access_token: string
	refresh_token: string
	expires: number
	email?: string
	accountId?: string
}

export type OpenAiCodexProfileAuthReadResult =
	| { status: "missing" }
	| { status: "malformed" }
	| { status: "valid"; credential: OpenAiOAuthCredentials }

export type OpenAiCodexProfileAuthSaveIfMissingResult = "saved" | "existing" | "malformed"

export interface OpenAiCodexProfileAuthRepositoryOptions {
	secretsDir?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requireNonEmptyString(record: Record<string, unknown>, key: "access_token" | "refresh_token"): string {
	const value = record[key]
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`OpenAI OAuth credential ${key} must be a non-empty string.`)
	}
	return value
}

export function parseOpenAiOAuthCredentials(value: unknown): OpenAiOAuthCredentials {
	if (!isRecord(value)) throw new Error("OpenAI OAuth credential must be a JSON object.")
	const expires = value.expires
	if (!Number.isSafeInteger(expires) || (expires as number) < MINIMUM_VALID_EXPIRY_MS) {
		throw new Error("OpenAI OAuth credential expires must be a valid millisecond timestamp.")
	}

	return {
		access_token: requireNonEmptyString(value, "access_token"),
		refresh_token: requireNonEmptyString(value, "refresh_token"),
		expires: expires as number,
		...(typeof value.type === "string" ? { type: value.type } : {}),
		...(typeof value.email === "string" ? { email: value.email } : {}),
		...(typeof value.accountId === "string" ? { accountId: value.accountId } : {}),
	}
}

function serializeCredential(credential: OpenAiOAuthCredentials): Record<string, unknown> {
	return {
		...(credential.type !== undefined ? { type: credential.type } : {}),
		access_token: credential.access_token,
		refresh_token: credential.refresh_token,
		expires: credential.expires,
		...(credential.email !== undefined ? { email: credential.email } : {}),
		...(credential.accountId !== undefined ? { accountId: credential.accountId } : {}),
	}
}

function preserveUnknownFields(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) return {}
	return Object.fromEntries(Object.entries(value).filter(([key]) => !KNOWN_CREDENTIAL_KEYS.has(key)))
}

async function renameWithRetry(sourcePath: string, destinationPath: string): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try {
			await fs.rename(sourcePath, destinationPath)
			return
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code
			if (!code || !RETRYABLE_RENAME_CODES.has(code) || attempt >= RENAME_RETRY_DELAYS_MS.length) throw error
			await new Promise<void>((resolve) => setTimeout(resolve, RENAME_RETRY_DELAYS_MS[attempt]))
		}
	}
}

async function atomicWriteCredential(filePath: string, value: Record<string, unknown>): Promise<void> {
	const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
	try {
		await fs.writeFile(tempPath, JSON.stringify(value, null, 2), { encoding: "utf8", flag: "wx", mode: 0o600 })
		await renameWithRetry(tempPath, filePath)
		await fs.chmod(filePath, 0o600)
	} catch (error) {
		await fs.unlink(tempPath).catch(() => undefined)
		throw error
	}
}

export class OpenAiCodexProfileAuthRepository {
	readonly secretsDir: string
	private readonly lock = new FileLock()

	constructor(options: OpenAiCodexProfileAuthRepositoryOptions = {}) {
		this.secretsDir = path.resolve(options.secretsDir ?? path.join(getDlineDataDir(), "secrets"))
	}

	filePath(profileId: string): string {
		return getOpenAiCodexProfileAuthPath(this.secretsDir, profileId)
	}

	async read(profileId: string): Promise<OpenAiCodexProfileAuthReadResult> {
		return this.readPath(this.filePath(profileId))
	}

	async save(profileId: string, credential: OpenAiOAuthCredentials): Promise<void> {
		const validated = parseOpenAiOAuthCredentials(credential)
		const filePath = this.filePath(profileId)
		await fs.mkdir(this.secretsDir, { recursive: true })
		await this.lock.withLock(filePath, async () => {
			const existing = await this.readRawObject(filePath)
			await atomicWriteCredential(filePath, { ...preserveUnknownFields(existing), ...serializeCredential(validated) })
		})
	}

	async saveIfMissing(
		profileId: string,
		credential: OpenAiOAuthCredentials,
	): Promise<OpenAiCodexProfileAuthSaveIfMissingResult> {
		return this.writeIfMissing(profileId, parseOpenAiOAuthCredentials(credential), {})
	}

	async importLegacyIfMissing(profileId: string, legacyValue: unknown): Promise<OpenAiCodexProfileAuthSaveIfMissingResult> {
		return this.writeIfMissing(profileId, parseOpenAiOAuthCredentials(legacyValue), preserveUnknownFields(legacyValue))
	}

	async delete(profileId: string): Promise<void> {
		const filePath = this.filePath(profileId)
		await fs.mkdir(this.secretsDir, { recursive: true })
		await this.lock.withLock(filePath, async () => {
			await fs.unlink(filePath).catch((error: NodeJS.ErrnoException) => {
				if (error.code !== "ENOENT") throw error
			})
		})
	}

	private async writeIfMissing(
		profileId: string,
		credential: OpenAiOAuthCredentials,
		unknownFields: Record<string, unknown>,
	): Promise<OpenAiCodexProfileAuthSaveIfMissingResult> {
		const filePath = this.filePath(profileId)
		await fs.mkdir(this.secretsDir, { recursive: true })
		return this.lock.withLock(filePath, async () => {
			const current = await this.readPath(filePath)
			if (current.status === "valid") return "existing"
			if (current.status === "malformed") return "malformed"
			await atomicWriteCredential(filePath, { ...unknownFields, ...serializeCredential(credential) })
			return "saved"
		})
	}

	private async readPath(filePath: string): Promise<OpenAiCodexProfileAuthReadResult> {
		let raw: string
		try {
			raw = await fs.readFile(filePath, "utf8")
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing" }
			throw error
		}
		try {
			return { status: "valid", credential: parseOpenAiOAuthCredentials(JSON.parse(raw)) }
		} catch {
			return { status: "malformed" }
		}
	}

	private async readRawObject(filePath: string): Promise<unknown> {
		try {
			return JSON.parse(await fs.readFile(filePath, "utf8"))
		} catch {
			return undefined
		}
	}
}
