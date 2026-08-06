import { UrlContentFetcher } from "@/services/browser/UrlContentFetcher"

export interface UrlContentFetcherPort {
	launchBrowser(): Promise<void>
	urlToMarkdown(url: string): Promise<string>
	closeBrowser(): Promise<void>
}

export interface LocalWebFetchRequest {
	readonly url: string
	readonly prompt: string
}

export interface LocalWebFetchResponse {
	readonly url: string
	readonly prompt: string
	readonly content: string
	readonly source: {
		readonly id: "browser"
		readonly label: "Browser Web Fetch"
		readonly execution: "dline"
	}
}

export interface LocalWebFetchProvider {
	fetch(request: LocalWebFetchRequest): Promise<LocalWebFetchResponse>
}

/** Fetch and clean one webpage with an isolated browser lifecycle. */
export class BrowserWebFetchProvider implements LocalWebFetchProvider {
	constructor(private readonly createFetcher: () => UrlContentFetcherPort = () => new UrlContentFetcher()) {}

	async fetch(request: LocalWebFetchRequest): Promise<LocalWebFetchResponse> {
		const fetcher = this.createFetcher()
		try {
			await fetcher.launchBrowser()
			const content = await fetcher.urlToMarkdown(request.url)
			return {
				url: request.url,
				prompt: request.prompt,
				content,
				source: {
					id: "browser",
					label: "Browser Web Fetch",
					execution: "dline",
				},
			}
		} finally {
			await fetcher.closeBrowser()
		}
	}
}
