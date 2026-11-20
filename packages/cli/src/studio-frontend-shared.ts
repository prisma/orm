export const STUDIO_CSS_FILE_NAME = 'studio.css'
export const STUDIO_JS_FILE_NAME = 'studio.js'

const STUDIO_ADAPTER_TYPES = ['mysql', 'postgres', 'sqlite'] as const

export type StudioAdapterType = (typeof STUDIO_ADAPTER_TYPES)[number]

export type StudioConfig = {
  adapter: StudioAdapterType
}

export function isStudioAdapterType(value: unknown): value is StudioAdapterType {
  return typeof value === 'string' && (STUDIO_ADAPTER_TYPES as readonly string[]).includes(value)
}
