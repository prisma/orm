import { link } from '@prisma/internals'
import { bold, green } from 'kleur/colors'

import type { CliDistributionIdentity } from '../utils/cli-distribution-identity'

export function successMessage(message: string): string {
  return `${green('Success!')} ${message}`
}

export function printPpgInitOutput({
  databaseUrl,
  workspaceId,
  projectId,
  environmentId,
  isExistingPrismaProject = false,
  identity,
}: {
  databaseUrl: string
  workspaceId: string
  projectId: string
  environmentId?: string
  isExistingPrismaProject?: boolean
  identity: CliDistributionIdentity
}): string {
  const newPrismaProjectOutput = `
We created an initial ${green('schema.prisma')} file and a ${green('.env')} file with your ${green(
    'DATABASE_URL',
  )} environment variable already set.

${bold('--- Next steps ---')}

Go to ${link('https://pris.ly/ppg-init')} for detailed instructions.

${bold('1. Define your database schema')}
Open the ${green('schema.prisma')} file and define your first models. Check the docs if you need inspiration: ${link(
    'https://pris.ly/ppg-init',
  )}.

${bold('2. Apply migrations')}
Run the following command to create and apply a migration:
${green(`npx ${identity} migrate dev --name init`)}

${bold('3. Manage your data')}
View and edit your data locally by running this command:
${green(`npx ${identity} studio`)}
${
  environmentId !== undefined
    ? `...or online in Console:
${link(`https://console.prisma.io/${workspaceId}/${projectId}/${environmentId}/studio`)}
`
    : ''
}
${bold(`4. Send queries from your app`)}
To access your database from a JavaScript/TypeScript app, you need to use Prisma ORM. Go here for step-by-step instructions: ${link(
    'https://pris.ly/ppg-init',
  )}
  `

  const existingPrismaProjectOutput = `
We found an existing ${green('schema.prisma')} file in your current project directory.

${bold('--- Database URL ---')}

Connect Prisma ORM to your Prisma Postgres database with this URL:

${green(databaseUrl)}

${bold('--- Next steps ---')}

Go to ${link('https://pris.ly/ppg-init')} for detailed instructions.

${bold('1. Install the Postgres adapter')}
${green('npm install @prisma/adapter-pg')}

...and add it to your Prisma Client instance:

${green('import { PrismaPg } from "@prisma/adapter-pg";')}
${green('import { PrismaClient } from "./generated/prisma/client";')}

${green('const connectionString = `${process.env.DATABASE_URL}`;')}

${green('const adapter = new PrismaPg({ connectionString });')}
${green('const prisma = new PrismaClient({ adapter });')}

${bold('2. Apply migrations')}
Run the following command to create and apply a migration:
${green(`npx ${identity} migrate dev`)}

${bold(`3. Manage your data`)}
View and edit your data locally by running this command:
${green(`npx ${identity} studio`)}
${
  environmentId !== undefined
    ? `...or online in Console:
${link(`https://console.prisma.io/${workspaceId}/${projectId}/${environmentId}/studio`)}
`
    : ''
}
${bold(`4. Send queries from your app`)}
If you already have an existing app with Prisma ORM, you can now run it and it will send queries against your newly created Prisma Postgres instance.

${bold(`5. Learn more`)}
For more info, visit the Prisma Postgres docs: ${link('https://pris.ly/ppg-docs')}
`

  return isExistingPrismaProject ? existingPrismaProjectOutput : newPrismaProjectOutput
}
