import { ActiveConnectorType, GeneratorConfig } from '@prisma/generator'

import { DMMFHelper } from '../dmmf'
import { GenericArgsInfo } from '../GenericsArgsInfo'

export interface GenerateContextOptions {
  dmmf: DMMFHelper
  genericArgsInfo: GenericArgsInfo
  generator?: GeneratorConfig
  provider: ActiveConnectorType
}

export class GenerateContext implements GenerateContextOptions {
  dmmf: DMMFHelper
  genericArgsInfo: GenericArgsInfo
  generator?: GeneratorConfig
  provider: ActiveConnectorType

  constructor({ dmmf, genericArgsInfo, generator, provider }: GenerateContextOptions) {
    this.dmmf = dmmf
    this.genericArgsInfo = genericArgsInfo
    this.generator = generator
    this.provider = provider
  }

  isPreviewFeatureOn(previewFeature: string): boolean {
    return this.generator?.previewFeatures?.includes(previewFeature) ?? false
  }

  isSqlProvider(): boolean {
    return this.provider !== 'mongodb'
  }
}
