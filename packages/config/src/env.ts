export class PrismaConfigEnvError extends Error {
  constructor(name: string) {
    super(`Cannot resolve environment variable: ${name}.`)
    this.name = 'PrismaConfigEnvError'
  }
}

type EnvKey<Env> = keyof {
  [K in keyof Env as Env[K] extends string | undefined ? K : never]: Env[K]
}

export function env(name: string): string
export function env<Env>(name: EnvKey<Env> & string): string
export function env(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new PrismaConfigEnvError(name)
  }
  return value
}
