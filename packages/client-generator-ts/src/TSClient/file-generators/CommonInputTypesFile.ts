import * as ts from '@prisma/ts-builders'

import { GenerateContext } from '../GenerateContext'
import { InputType } from '../Input'

const jsDocHeader = `/*
 * This file exports various common sort, input & filter types that are not directly linked to a particular model.
 *
 * 🟢 You can import this file directly.
 */
`

export function createCommonInputTypeFiles(context: GenerateContext) {
  const imports = [
    ts.moduleImport(context.runtimeImport).asNamespace('runtime').typeOnly(),
    ts.moduleImport(context.importFileName(`./enums`)).asNamespace('$Enums'),
    ts.moduleImport(context.importFileName(`./internal/prismaNamespace`)).asNamespace('Prisma').typeOnly(),
  ].map((i) => ts.stringify(i))

  const genericInputTypes =
    context.dmmf.inputObjectTypes.prisma
      // Only contains generic input types that are not directly linked to a particular model
      ?.filter((i) => !i.meta?.grouping)
      ?.map((inputType) => new InputType(inputType, context).toTS()) ?? []

  return `${jsDocHeader}
${imports.join('\n')}

${genericInputTypes.join('\n')}

${context.dmmf.inputObjectTypes.model?.map((inputType) => new InputType(inputType, context).toTS()).join('\n') ?? ''}
`
}
