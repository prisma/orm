import path from 'node:path'

import arg from 'arg'
import { execaCommand } from 'execa'
import { bold, dim, red, underline } from 'kleur/colors'

const argv = arg({})
const usage = `
${bold('Usage')}
\t(${dim('pnpm bump-engines 2.19.0-39.c1455d0b443d66b0d9db9bcb1bb9ee0d5bbc511d')}
\t{${dim('pnpm bump-engines latest')}
\t{${dim('pnpm bump-engines integration')}
\t{${dim('pnpm bump-engines patch')}
`

async function main() {
  let version = argv._[0]
  if (!version) {
    console.error(`No Version Found\n${usage}`)
    console.log(`Defaulting to ${dim('latest')}`)
    version = 'latest'
  }

  await run(path.join(__dirname, '..'), `pnpm update -r @prisma/engines-version@${version}`)
  await run(path.join(__dirname, '..'), `pnpm update -r @prisma/prisma-schema-wasm@${version}`)
  await run(path.join(__dirname, '..'), `pnpm update -r @prisma/query-compiler-wasm@${version}`)
  await run(path.join(__dirname, '..'), `pnpm update -r @prisma/schema-engine-wasm@${version}`)

  await run(path.join(__dirname, '..'), `pnpm run --filter @prisma/engines dev`)
  await run(path.join(__dirname, '..'), `pnpm run --filter @prisma/engines postinstall`)
}

void main()

async function run(cwd: string, cmd: string): Promise<void> {
  console.log(underline('./' + cwd).padEnd(20), bold(cmd))
  try {
    await execaCommand(cmd, {
      cwd,
      stdio: 'inherit',
    })
  } catch (e) {
    throw new Error(bold(red(`Error running ${bold(cmd)} in ${underline(cwd)}:`)) + (e.stderr || e.stack || e.message))
  }
}
