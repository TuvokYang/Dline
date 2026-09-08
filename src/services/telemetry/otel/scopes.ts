/**
 * Instrumentation scope names for the shared telemetry pipeline.
 *
 * These are the keys the scope router dispatches on, so they are also the
 * boundary between what each consumer may receive. The SDK stamps the scope on
 * a record when it is emitted, from the logger that emitted it, so a producer
 * cannot claim a scope it does not belong to.
 *
 * They live in a module of their own — with no state and no imports — so both
 * the routing layer and the pure event-mapping layer can depend on one
 * definition without either pulling in the other's dependencies.
 */

/**
 * Product analytics: usage and feature statistics.
 *
 * The bare name is kept for compatibility with collectors already configured
 * against it.
 */
export const USAGE_SCOPE_NAME = "dline"

/**
 * Crash and exception reports.
 *
 * Separate from usage because the two are consented to separately: a collector
 * attached here must not receive analytics the user did not agree to.
 */
export const ERROR_SCOPE_NAME = "dline.error"

/** Runtime diagnostics: local performance phases and health snapshots. */
export const RUNTIME_SCOPE_NAME = "dline.runtime"

/** Version of the runtime event schema carried on each record. */
export const RUNTIME_SCOPE_VERSION = "1"
