import { blue, bold, dim } from 'kleur/colors'

import { highlightDatamodel } from '../highlight/highlight'
import { link } from './link'

export function missingGeneratorMessage(cliCommand: string): string {
  return `\n${blue('info')} You don't have any generators defined in your ${bold(
    'schema.prisma',
  )}, so nothing will be generated.
Add the Prisma Client generator like this:

${bold(
  highlightDatamodel(`generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}`),
)}

Then run ${dim('$')} ${cliCommand} generate.

More information in our documentation:
${link('https://pris.ly/d/prisma-schema')}
`
}

export function missingModelMessage(cliCommand: string): string {
  return `\nYou don't have any ${bold('models')} defined in your ${bold('schema.prisma')}, so nothing will be generated.

Prisma Client is typically generated from models defined in your schema. If you plan to use raw SQL queries only (e.g. ${bold('$queryRaw')}), remove the ${bold('--require-models')} flag to generate the client without models:

  ${dim('$')} ${cliCommand} generate

Otherwise, you can define a model like this:

${bold(
  highlightDatamodel(`model User {
  id    Int     @id @default(autoincrement())
  email String  @unique
  name  String?
}`),
)}

More information in our documentation:
${link('https://pris.ly/d/prisma-schema')}
`
}

export function missingModelMessageMongoDB(cliCommand: string): string {
  return `\nYou don't have any ${bold('models')} defined in your ${bold('schema.prisma')}, so nothing will be generated.

Prisma Client is typically generated from models defined in your schema. If you plan to use raw queries only, remove the ${bold('--require-models')} flag to generate the client without models:

  ${dim('$')} ${cliCommand} generate

Otherwise, you can define a model like this:

${bold(
  highlightDatamodel(`model User {
  id    String  @id @default(auto()) @map("_id") @db.ObjectId
  email String  @unique
  name  String?
}`),
)}

More information in our documentation:
${link('https://pris.ly/d/prisma-schema')}
`
}
