import { timingSafeEqual } from "node:crypto"
import { OAuthFlowError } from "./types"

export interface ParsedOAuthCallback {
	code: string
}

function safeEqual(left: string, right: string): boolean {
	const leftBytes = Buffer.from(left)
	const rightBytes = Buffer.from(right)
	return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

export function parseOAuthCallbackUri(
	callbackUri: string,
	expectedRedirectUri: string,
	expectedState: string,
): ParsedOAuthCallback {
	let callback: URL
	let expected: URL
	try {
		callback = new URL(callbackUri)
		expected = new URL(expectedRedirectUri)
	} catch {
		throw new OAuthFlowError("CALLBACK_URI_INVALID", "The OAuth callback URI is invalid.")
	}

	if (callback.origin !== expected.origin || callback.pathname !== expected.pathname) {
		throw new OAuthFlowError("CALLBACK_URI_MISMATCH", "The OAuth callback URI does not match the active flow.")
	}

	const state = callback.searchParams.get("state")
	if (!state || !safeEqual(state, expectedState)) {
		throw new OAuthFlowError("STATE_MISMATCH", "The OAuth callback state does not match the active flow.")
	}

	if (callback.searchParams.has("error")) {
		throw new OAuthFlowError("AUTHORIZATION_DENIED", "OAuth authorization was not completed.", true)
	}

	const code = callback.searchParams.get("code")
	if (!code) {
		throw new OAuthFlowError("CALLBACK_MISSING_PARAMETERS", "The OAuth callback is missing an authorization code.")
	}
	return { code }
}
