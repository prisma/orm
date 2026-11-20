import { $ } from 'zx'

void (async () => {
  const postgresProjects = ['da-workers-neon', 'da-workers-pg']
  const sqliteProjects = ['da-workers-libsql', 'da-workers-libsql-web', 'da-workers-d1']
  const mysqlProjects = ['da-workers-planetscale', 'da-workers-mariadb']
  const mssqlProjects = ['da-workers-mssql']

  const nodeCompatProjects = new Set([
    'da-workers-pg',
    'da-workers-d1',
    'da-workers-planetscale',
    'da-workers-mssql',
    'da-workers-mariadb',
  ])

  const projects = [...postgresProjects, ...sqliteProjects, ...mysqlProjects, ...mssqlProjects]

  const getSchemaFile = (project: string) => {
    if (postgresProjects.includes(project)) {
      return `${__dirname}/schema.postgres.prisma`
    }
    if (mysqlProjects.includes(project)) {
      return `${__dirname}/schema.mysql.prisma`
    }
    if (mssqlProjects.includes(project)) {
      return `${__dirname}/schema.mssql.prisma`
    }
    return `${__dirname}/schema.sqlite.prisma`
  }

  // Invoke the Prisma CLI through the workspace dependency symlink rather than a
  // `prisma` entry in node_modules/.bin: pnpm 11 does not create a workspace
  // package's bin when the target file is absent at install time (the CLI is
  // built afterwards) and never backfills it, so `pnpm prisma` cannot find it.
  const prismaCli = `${__dirname}/node_modules/prisma/build/index.js`

  await $`pnpm list -r --depth -2` // print the versions of the dependencies installed

  for (const project of projects) {
    const compatFlags = nodeCompatProjects.has(project) ? 'nodejs_compat' : ''
    const projectDir = `${__dirname}/${project}`

    // Install deps & copy schema & generate Prisma Client
    await $`cp ${getSchemaFile(project)} ${projectDir}/schema.prisma`
    await $`node ${prismaCli} generate --schema=${projectDir}/schema.prisma`.catch((error) => {
      const e = error as Error
      console.error(
        `Failed to generate Prisma Client from ${getSchemaFile(project)} (copied to ${projectDir}/schema.prisma)`,
      )
      throw e
    })

    // Delete existing output (if it exists)
    await $`rm -rf ${projectDir}/output`
    await $`rm -rf ${projectDir}/output.tgz`

    // Use wrangler to generate the function output
    await $`pnpm wrangler deploy ${projectDir}/index.js \
      --dry-run \
      --outdir=${projectDir}/output \
      --compatibility-date 2025-10-23 \
      --compatibility-flags "${compatFlags}" \
      --name ${project} \
      --tsconfig ${__dirname}/tsconfig.json`

    // Delete *.js.map & Markdown files
    await $`rm ${projectDir}/output/*.js.map`
    await $`rm ${projectDir}/output/*.md`

    // Create the archive based on wrangler's output
    await $`gzip -cr ${projectDir}/output > ${projectDir}/output.tgz`

    // Print size
    await $`echo "Size of ${project}:"`
    await $`echo "$(echo "$(cat ${projectDir}/output.tgz | wc -c) / 1000" | bc)KB"`
    await $`echo "$(echo "$(cat ${projectDir}/output.tgz | wc -c) * 0.976562 / 1000" | bc)KiB"`
  }
})()
