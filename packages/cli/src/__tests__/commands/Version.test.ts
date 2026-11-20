import { enginesVersion } from '@prisma/engines'
import { jestConsoleContext, jestContext } from '@prisma/get-platform'
import { version as typeScriptVersion } from 'typescript'

import packageJson from '../../../package.json'

const ctx = jestContext.new().add(jestConsoleContext()).assemble()

describe('version', () => {
  test('does not download query-engine', async () => {
    ctx.fixture('version')
    const data = await ctx.cli('version')
    expect(data.exitCode).toBe(0)
    expect(cleanSnapshot(data.stdout)).toMatchInlineSnapshot(`
      "prisma               : 0.0.0
      @prisma/client       : 0.0.0
      Operating System     : OS
      Architecture         : ARCHITECTURE
      Node.js              : NODEJS_VERSION
      TypeScript           : TYPESCRIPT_VERSION
      Query Compiler       : enabled
      PSL                  : @prisma/prisma-schema-wasm CLI_VERSION.ENGINE_VERSION
      Schema Engine        : schema-engine-cli ENGINE_VERSION (at sanitized_path/schema-engine-TEST_PLATFORM)
      Default Engines Hash : ENGINE_VERSION
      Studio               : STUDIO_VERSION
      Prisma CLI Path      : sanitized_path"
    `)
    expect(cleanSnapshot(data.stderr)).toMatchInlineSnapshot(`
      "Loaded Prisma config from prisma.config.ts.

      Prisma schema loaded from schema.prisma."
    `)
  })

  test('includes Prisma CLI package path in JSON output', async () => {
    ctx.fixture('version')
    const data = await ctx.cli('version', '--json')
    expect(data.exitCode).toBe(0)

    const json = JSON.parse(data.stdout) as Record<string, string>
    expect(json['prisma-cli-path']).toEqual(expect.any(String))
    expect(json['prisma-cli-path']).not.toHaveLength(0)
  })
})

function cleanSnapshot(str: string, versionOverride?: string): string {
  // sanitize engine path
  // Schema Engine : schema-engine e996df5d66a2314d1da15d31047f9777fc2fbdd9 (at ../../home/runner/work/prisma/prisma/node_modules/.pnpm/@prisma+engines@3.11.0-41.e996df5d66a2314d1da15d31047f9777fc2fbdd9/node_modules/@prisma/engines/schema-engine-TEST_PLATFORM)
  // +
  // Schema Engine : schema-engine 5a2e5869b69a983e279380ec68596b71beae9eff (at ../../cli/src/__tests__/commands/version-test-engines/schema-engine-TEST_PLATFORM, resolved by PRISMA_SCHEMA_ENGINE_BINARY)
  // =>
  // Schema Engine : schema-engine e996df5d66a2314d1da15d31047f9777fc2fbdd9 (at sanitized_path/schema-engine-TEST_PLATFORM)
  //                                                                                    ^^^^^^^^^^^^^^^^^^^
  str = str.replace(/\(at (.*engines)(\/|\\)/g, '(at sanitized_path/')

  // Replace 'Loaded Prisma config from "/.../prisma.config.ts"'
  // with 'Loaded Prisma config from "sanitized prisma.config.ts path"'
  str = str.replace(
    /Loaded Prisma config from ".*(\/|\\)prisma\.config\.ts"/g,
    'Loaded Prisma config from "sanitized prisma.config.ts path"',
  )

  // TODO: replace '[a-z0-9]{40}' with 'ENGINE_VERSION'.
  // Currently, the engine version of @prisma/prisma-schema-wasm isn't necessarily the same as the enginesVersion
  str = str.replace(/([0-9]+\.[0-9]+\.[0-9]+-[0-9]+\.)([a-z0-9-]+)/g, 'CLI_VERSION.ENGINE_VERSION')

  // Replace locally built prisma-schema-wasm and schema-engine-wasm versions linked via package.json
  str = str.replace(/link:([A-Z]:)?(\/[\w-]+)+/g, 'CLI_VERSION.ENGINE_VERSION')

  // replace engine version hash
  const defaultEngineVersion = enginesVersion
  const currentEngineVersion = versionOverride ?? enginesVersion
  str = str.replace(new RegExp(currentEngineVersion, 'g'), 'ENGINE_VERSION')
  str = str.replace(new RegExp(defaultEngineVersion, 'g'), 'ENGINE_VERSION')
  str = str.replace(new RegExp('(Operating System\\s+:).*', 'g'), '$1 OS')
  str = str.replace(new RegExp('(Architecture\\s+:).*', 'g'), '$1 ARCHITECTURE')
  str = str.replace(new RegExp('workspace:\\*', 'g'), 'ENGINE_VERSION')
  str = str.replace(new RegExp(process.version, 'g'), 'NODEJS_VERSION')
  str = str.replace(new RegExp(`(TypeScript\\s+:) ${typeScriptVersion}`, 'g'), '$1 TYPESCRIPT_VERSION')

  // replace studio version
  str = str.replace(packageJson.dependencies['@prisma/studio-core'], 'STUDIO_VERSION')

  // sanitize windows specific engine names
  str = str.replace(/\.exe/g, '')

  // replace Prisma CLI package path
  str = str.replace(/(Prisma CLI Path\s+: ).*/g, '$1sanitized_path')

  return str
}
