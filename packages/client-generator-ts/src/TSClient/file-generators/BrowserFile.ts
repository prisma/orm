import { GenerateContext } from '../GenerateContext'
import { modelExports } from '../ModelExports'
import { TSClientOptions } from '../TSClient'

const jsDocHeader = `/*
 * This file should be your main import to use Prisma-related types and utilities in a browser. 
 * Use it to get access to models, enums, and input types.
 * 
 * This file does not contain a \`PrismaClient\` class, nor several other helpers that are intended as server-side only.
 * See \`client.ts\` for the standard, server-side entry point.
 *
 * 🟢 You can import this file directly.
 */
`

export function createBrowserFile(context: GenerateContext, _options: TSClientOptions): string {
  return `${jsDocHeader}
import * as Prisma from '${context.importFileName('./internal/prismaNamespaceBrowser')}'
export { Prisma }
export * as $Enums from '${context.importFileName('./enums')}'
export * from '${context.importFileName('./enums')}';
${modelExports(context).join('\n')}
`
}
