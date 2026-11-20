import * as ts from '@prisma/ts-builders'

import { GenerateContext } from '../GenerateContext'
import { Model } from '../Model'

export function createModelFile(context: GenerateContext, modelName: string): string {
  const jsDocHeader = `/*
 * This file exports the \`${modelName}\` model and its related types.
 *
 * 🟢 You can import this file directly.
 */
`

  const imports = [
    ts.moduleImport(context.runtimeImport).asNamespace('runtime').typeOnly(),
    ts.moduleImport(context.importFileName(`../enums`)).asNamespace('$Enums').typeOnly(),
    ts.moduleImport(context.importFileName(`../internal/prismaNamespace`)).asNamespace('Prisma').typeOnly(),
  ]
  const importsString = imports.map((i) => ts.stringify(i)).join('\n')

  const model = context.dmmf.typeAndModelMap[modelName]

  return jsDocHeader + importsString + '\n' + new Model(model, context).toTS()
}
