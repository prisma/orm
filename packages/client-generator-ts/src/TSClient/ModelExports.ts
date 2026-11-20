import * as ts from '@prisma/ts-builders'

import { GenerateContext } from './GenerateContext'

export function modelExports(context: GenerateContext): string[] {
  return (
    Object.values(context.dmmf.typeAndModelMap)
      // choose models that have output types
      .filter((model) => context.dmmf.outputTypeMap.model[model.name])

      // generate export statements
      .map((model) => {
        const docLines = model.documentation ?? ''
        const modelLine = `Model ${model.name}\n`
        const docs = `${modelLine}${docLines}`
        const suffix = 'Model'

        const modelTypeExport = ts
          // e.g., `export type User = Prisma.UserModel` when `model.name` is `User`
          .moduleExport(ts.typeDeclaration(model.name, ts.namedType(`Prisma.${model.name}${suffix}`)))
          // add JSDoc comment with the model name and documentation
          .setDocComment(ts.docComment(docs))

        return ts.stringify(modelTypeExport)
      })
  )
}
