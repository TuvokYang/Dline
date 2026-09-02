import http from "node:http"
import { OAuthFlowError } from "./types"

export interface LocalOAuthCallbackServerOptions {
	host?: string
	port: number
	callbackPath: string
	onCallback: (callbackUri: string) => Promise<void>
}

const SUCCESS_HTML = "<!doctype html><html><body><h1>Authentication complete</h1><p>You can close this window.</p></body></html>"
const FAILURE_HTML =
	"<!doctype html><html><body><h1>Authentication failed</h1><p>Return to the application and try again.</p></body></html>"

export class LocalOAuthCallbackServer {
	private constructor(
		private readonly server: http.Server,
		readonly redirectUri: string,
	) {}

	static async listen(options: LocalOAuthCallbackServerOptions): Promise<LocalOAuthCallbackServer> {
		const host = options.host ?? "127.0.0.1"
		let baseUrl = `http://${host}:${options.port}`
		const server = http.createServer(async (request, response) => {
			const callback = new URL(request.url ?? "/", baseUrl)
			if (callback.pathname !== options.callbackPath) {
				response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
				response.end("Not Found")
				return
			}
			try {
				await options.onCallback(callback.toString())
				response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
				response.end(SUCCESS_HTML)
			} catch (error) {
				const status = error instanceof OAuthFlowError && error.code === "TOKEN_EXCHANGE_FAILED" ? 500 : 400
				response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" })
				response.end(FAILURE_HTML)
			}
		})

		await new Promise<void>((resolve, reject) => {
			server.once("error", (error: NodeJS.ErrnoException) => {
				if (error.code === "EADDRINUSE") {
					reject(new OAuthFlowError("CALLBACK_PORT_IN_USE", "The OAuth callback port is already in use."))
					return
				}
				reject(
					new OAuthFlowError("CALLBACK_SERVER_FAILED", "The OAuth callback server could not start.", false, {
						cause: error,
					}),
				)
			})
			server.listen(options.port, host, () => resolve())
		})
		const address = server.address()
		if (!address || typeof address === "string") {
			server.close()
			throw new OAuthFlowError("CALLBACK_SERVER_FAILED", "The OAuth callback server did not expose a TCP address.")
		}
		baseUrl = `http://${host}:${address.port}`
		return new LocalOAuthCallbackServer(server, new URL(options.callbackPath, baseUrl).toString())
	}

	async close(): Promise<void> {
		if (!this.server.listening) return
		await new Promise<void>((resolve, reject) => {
			this.server.close((error) => (error ? reject(error) : resolve()))
		})
	}
}
