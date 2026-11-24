import { GeneratorConfig, GeneratorManifest, GeneratorOptions } from './configuration'

export type Generator = {
  readonly name: string
  /**
   * Usage instructions the CLI prints after this generator's success message
   * on `prisma generate`.
   */
  readonly usageHint?: string
  getManifest(config: GeneratorConfig): Promise<GeneratorManifest>
  generate(options: GeneratorOptions): Promise<void>
}
