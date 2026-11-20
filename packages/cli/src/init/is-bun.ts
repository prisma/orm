/** Indicates if the CLI runs on the Bun runtime. */
export const isBun: boolean =
  'Bun' in globalThis || typeof (process.versions as Record<string, string | undefined>).bun === 'string'
