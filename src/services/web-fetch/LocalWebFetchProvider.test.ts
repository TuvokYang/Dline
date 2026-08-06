import { describe, expect, it, vi } from "vitest"
import { BrowserWebFetchProvider, type UrlContentFetcherPort } from "./LocalWebFetchProvider"

function contentFetcher(markdown = "# Dline\n\nFetched locally") {
	return {
		launchBrowser: vi.fn(async () => undefined),
		urlToMarkdown: vi.fn(async () => markdown),
		closeBrowser: vi.fn(async () => undefined),
	} satisfies UrlContentFetcherPort
}

describe("BrowserWebFetchProvider", () => {
	it("fetches cleaned Markdown locally and reports the Dline execution source", async () => {
		const fetcher = contentFetcher()
		const provider = new BrowserWebFetchProvider(() => fetcher)

		await expect(
			provider.fetch({
				url: "https://example.test/docs",
				prompt: "Extract the release notes",
			}),
		).resolves.toEqual({
			url: "https://example.test/docs",
			prompt: "Extract the release notes",
			content: "# Dline\n\nFetched locally",
			source: {
				id: "browser",
				label: "Browser Web Fetch",
				execution: "dline",
			},
		})
		expect(fetcher.launchBrowser).toHaveBeenCalledOnce()
		expect(fetcher.urlToMarkdown).toHaveBeenCalledWith("https://example.test/docs")
		expect(fetcher.closeBrowser).toHaveBeenCalledOnce()
	})

	it("closes the browser when page retrieval fails and preserves the actionable error", async () => {
		const fetcher = contentFetcher()
		fetcher.urlToMarkdown.mockRejectedValueOnce(new Error("Navigation timed out"))
		const provider = new BrowserWebFetchProvider(() => fetcher)

		await expect(provider.fetch({ url: "https://example.test/slow", prompt: "Read the page" })).rejects.toThrow(
			"Navigation timed out",
		)
		expect(fetcher.closeBrowser).toHaveBeenCalledOnce()
	})
})
