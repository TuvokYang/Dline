# Networking, Proxy, and Provider Observability

Dline currently runs as a VS Code extension. Extension-host network traffic must use the shared transport layer so corporate proxies, cancellation, request headers, timeouts, and provider-attempt observability remain consistent.

## Core and extension code

Do not use global `fetch` or a default Axios instance outside the shared networking implementation.

Use `@shared/net`:

```typescript
import { fetch } from "@shared/net"

const response = await fetch(url, { signal })
```

For Axios, include the shared settings:

```typescript
import axios from "axios"
import { getAxiosSettings } from "@shared/net"

const response = await axios.get(url, {
  signal,
  ...getAxiosSettings(),
})
```

`src/shared/net.ts` is allowed to use lower-level primitives because it owns the wrappers.

## Provider traffic

API provider requests should use `providerFetch` so the request participates in provider-attempt observation and shared transport behavior:

```typescript
import { providerFetch } from "@shared/net"

const response = await providerFetch(url, { method: "POST", signal })
```

For OpenAI-compatible SDKs, prefer `createOpenAIClient()` or the provider-specific shared factory, such as `createOpenAIClientForProfile()`. These factories inject `providerFetch`, proxy support, external headers, and profile-specific authentication behavior.

Do not construct a raw OpenAI client with global fetch when an existing factory applies. If a third-party SDK accepts a custom fetch/dispatcher/agent, inject the shared Dline transport.

Use plain shared `fetch` only for non-provider network traffic that should not be counted as an API generation attempt.

## Webview code

The Webview runs in the browser/embedder network environment and may use browser `fetch`. Do not import Node proxy agents into the Webview bundle.

Security-sensitive authorization and secret-bearing requests should remain in the extension/core host unless the product contract explicitly places them in the Webview.

## Required behavior

Every new network boundary must define:

- finite timeout or inherited bounded timeout;
- `AbortSignal` propagation where cancellation is possible;
- retry conditions, maximum attempts, and idempotency;
- sanitized errors that do not expose tokens, headers, account payloads, or request bodies;
- proxy behavior for standalone and IDE hosts;
- response-body cleanup when a stream consumer stops early;
- telemetry/observability ownership without logging sensitive content.

Do not retry authentication, billing, or non-idempotent writes generically.

## Tests

Use `mockFetchForTesting` to replace the shared transport for a bounded callback or promise. Restore is automatic when the callback settles.

Provider tests should assert that the shared factory or `providerFetch` is used, and should cover cancellation, timeout, retry/fallback identity, stream cleanup, and sanitized failures as applicable.

## Verification checklist

1. No global `fetch` or default Axios was introduced in core/extension code.
2. Provider traffic uses `providerFetch` or an approved shared client factory.
3. Third-party clients receive the custom transport.
4. Abort and timeout reach the underlying request.
5. Errors and logs omit secrets and unnecessary user data.
6. Proxy-aware behavior is covered or explicitly documented as unverified for the target host.
