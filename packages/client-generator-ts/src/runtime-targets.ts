export const supportedInternalRuntimes = ['nodejs', 'workerd', 'vercel-edge', 'deno'] as const
const supportedPublicRuntimes = ['nodejs', 'deno', 'bun', 'workerd', 'cloudflare', 'vercel-edge', 'edge-light'] as const

/**
 * The user-facing `runtime` attribute for the `prisma-client` generator.
 */
export type RuntimeTarget = (typeof supportedPublicRuntimes)[number]

/**
 * The internal representation of the `runtime` attribute for the `prisma-client` generator.
 */
export type RuntimeTargetInternal = (typeof supportedInternalRuntimes)[number]

function parseRuntimeTarget(target: RuntimeTarget | (string & {})): RuntimeTargetInternal {
  switch (target.toLowerCase()) {
    case 'workerd':
    case 'cloudflare':
      return 'workerd'

    case 'edge-light':
    case 'vercel-edge':
      return 'vercel-edge'

    case 'nodejs':
    case 'bun':
      return 'nodejs'

    case 'deno':
      return 'deno'

    default:
      throw new Error(
        `Unknown target runtime: "${target}". The available options are: ${supportedPublicRuntimes
          .map((runtime) => `"${runtime}"`)
          .join(', ')}`,
      )
  }
}

export function parseRuntimeTargetFromUnknown(target: unknown) {
  if (typeof target !== 'string') {
    throw new Error(`Invalid target runtime: ${JSON.stringify(target)}. Expected a string.`)
  }
  return parseRuntimeTarget(target)
}
