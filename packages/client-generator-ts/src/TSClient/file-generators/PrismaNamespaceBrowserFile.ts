import * as ts from '@prisma/ts-builders'

import { Enum } from '../Enum'
import { GenerateContext } from '../GenerateContext'
import { nullTypes } from '../NullTypes'

const jsDocHeader = `/*
 * WARNING: This is an internal file that is subject to change!
 *
 * 🛑 Under no circumstances should you import this file directly! 🛑
 *
 * All exports from this file are wrapped under a \`Prisma\` namespace object in the browser.ts file.
 * While this enables partial backward compatibility, it is not part of the stable public API.
 *
 * If you are looking for your Models, Enums, and Input Types, please import them from the respective
 * model files in the \`model\` directory!
 */
`
export function createPrismaNamespaceBrowserFile(context: GenerateContext): string {
  const prismaEnums = context.dmmf.schema.enumTypes.prisma?.map((type) => new Enum(type, true).toTS())

  return `${jsDocHeader}
${ts.stringify(ts.moduleImport(`${context.runtimeBase}/index-browser`).asNamespace('runtime'))}

export type * from '${context.importFileName(`../models`)}'
export type * from '${context.importFileName(`./prismaNamespace`)}'

export const Decimal = runtime.Decimal

${nullTypes}

${new Enum(
  {
    name: 'ModelName',
    values: context.dmmf.mappings.modelOperations.map((m) => m.model),
  },
  true,
).toTS()}
/*
 * Enums
 */

${prismaEnums?.join('\n\n')}
`
}
