import { ActiveConnectorType, GeneratorConfig } from '@prisma/generator'

import { DMMFHelper } from '../dmmf'
import { FileNameMapper } from '../file-extensions'
import { GenericArgsInfo } from '../GenericsArgsInfo'

export interface GenerateContextOptions {
  dmmf: DMMFHelper
  genericArgsInfo: GenericArgsInfo
  runtimeBase: string
  runtimeImport: string
  outputFileName: FileNameMapper
  importFileName: FileNameMapper
  generator?: GeneratorConfig
  provider: ActiveConnectorType
}

export class GenerateContext implements GenerateContextOptions {
  dmmf: DMMFHelper
  genericArgsInfo: GenericArgsInfo
  runtimeBase: string
  runtimeImport: string
  outputFileName: FileNameMapper
  importFileName: FileNameMapper
  generator?: GeneratorConfig
  provider: ActiveConnectorType

  constructor({
    dmmf,
    genericArgsInfo,
    runtimeBase,
    runtimeImport,
    outputFileName,
    importFileName,
    generator,
    provider,
  }: GenerateContextOptions) {
    this.dmmf = dmmf
    this.genericArgsInfo = genericArgsInfo
    this.runtimeBase = runtimeBase
    this.runtimeImport = runtimeImport
    this.outputFileName = outputFileName
    this.importFileName = importFileName
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
