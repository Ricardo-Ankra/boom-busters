/**
 * Stands in for `server-only` under Vitest.
 *
 * `server-only` is a build-time marker: Next's bundler resolves it to a module
 * that throws if a file importing it ends up in a client bundle. Outside that
 * bundler there is nothing to resolve, so tests alias it here. The guarantee it
 * provides is a build-time one and is unaffected.
 */
export {}
