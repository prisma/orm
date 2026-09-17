import type {
  BinaryPaths,
  Generator as IGenerator,
  GeneratorConfig,
  GeneratorManifest,
  GeneratorOptions,
} from '@prisma/generator'
import { GeneratorProcess } from '@prisma/generator-helper'

import { parseEnvValue } from './utils/parseEnvValue'

export abstract class Generator {
  public manifest: GeneratorManifest | null = null
  public config: GeneratorConfig
  public options?: GeneratorOptions

  constructor(config: GeneratorConfig) {
    this.config = config
  }

  async init(): Promise<void> {
    await this.initImpl()
    this.manifest = await this.getManifest()
  }

  protected abstract initImpl(): Promise<void>

  protected abstract getManifest(): Promise<GeneratorManifest | null>

  abstract stop(): void

  generate(): Promise<void> {
    if (!this.options) {
      throw new Error(`Please first run .setOptions() on the Generator to initialize the options`)
    }
    return this.generateImpl(this.options)
  }

  protected abstract generateImpl(options: GeneratorOptions): Promise<void>

  setOptions(options: GeneratorOptions): void {
    this.options = options
  }

  setBinaryPaths(binaryPaths: BinaryPaths): void {
    if (!this.options) {
      throw new Error(`Please first run .setOptions() on the Generator to initialize the options`)
    }
    this.options.binaryPaths = binaryPaths
  }

  /**
   * Returns the pretty name of the generator specified in the manifest (e.g.,
   * "Prisma Client"), or, if the former is not defined, the generator's
   * provider name (e.g., "prisma-client-js") as a fallback.
   */
  getPrettyName(): string {
    return this.manifest?.prettyName ?? this.getProvider()
  }

  /**
   * Returns the provider name, parsed and resolved from environment variable
   * if necessary.
   */
  getProvider(): string {
    return parseEnvValue(this.config.provider)
  }

  /**
   * Usage instructions the CLI prints after this generator's success message
   * on `prisma generate`, if the generator provides any.
   */
  get usageHint(): string | undefined {
    return undefined
  }
}

export class JsonRpcGenerator extends Generator {
  #generatorProcess: GeneratorProcess

  constructor(executablePath: string, config: GeneratorConfig, isNode?: boolean) {
    super(config)
    this.#generatorProcess = new GeneratorProcess(executablePath, { isNode })
  }

  protected override async initImpl(): Promise<void> {
    await this.#generatorProcess.init()
  }

  protected override async getManifest(): Promise<GeneratorManifest | null> {
    return await this.#generatorProcess.getManifest(this.config)
  }

  protected override async generateImpl(options: GeneratorOptions): Promise<void> {
    await this.#generatorProcess.generate(options)
  }

  override stop(): void {
    this.#generatorProcess.stop()
  }
}

export class InProcessGenerator extends Generator {
  #generator: IGenerator

  constructor(config: GeneratorConfig, generator: IGenerator) {
    super(config)
    this.#generator = generator
  }

  protected override async initImpl(): Promise<void> {}

  protected override async getManifest(): Promise<GeneratorManifest | null> {
    return await this.#generator.getManifest(this.config)
  }

  protected override async generateImpl(options: GeneratorOptions): Promise<void> {
    await this.#generator.generate(options)
  }

  override stop(): void {}

  override get usageHint(): string | undefined {
    return this.#generator.usageHint
  }
}
