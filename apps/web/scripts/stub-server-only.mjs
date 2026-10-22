import { register } from 'node:module'

/**
 * Next resolves `server-only` to an empty module on the server and throws in
 * a client bundle; plain Node has neither the package nor the condition. A
 * live harness is server code by definition, so it gets the empty module.
 */
register(
  'data:text/javascript,' +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === 'server-only') return { url: 'data:text/javascript,', shortCircuit: true }
  return next(specifier, context)
}`),
)
