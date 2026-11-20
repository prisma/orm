import Debug from '@prisma/debug'
import { enginesVersion } from '@prisma/engines'
import type {
  BinaryTargetsEnvValue,
  EngineType,
  Generator as IGenerator,
  GeneratorConfig,
  GeneratorOptions,
  SqlQueryOutput,
} from '@prisma/generator'
import type { BinaryTarget } from '@prisma/get-platform'
import { binaryTargets, getBinaryTargetForCurrentPlatform } from '@prisma/get-platform'
import { bold, gray, green, red, underline, yellow } from 'kleur/colors'
import pMap from 'p-map'
import path from 'path'
import { match } from 'ts-pattern'

import { loadSchemaContext, SchemaContext } from '../cli/schemaContext'
import { getDMMF, mergeSchemas } from '../engine-commands'
import { Generator, InProcessGenerator, JsonRpcGenerator } from '../Generator'
import { resolveOutput } from '../resolveOutput'
import { missingDatasource } from '../utils/missingDatasource'
import { missingModelMessage, missingModelMessageMongoDB } from '../utils/missingGeneratorMessage'
import { parseBinaryTargetsEnvValue, parseEnvValue } from '../utils/parseEnvValue'
import { pick } from '../utils/pick'
import { printConfigWarnings } from '../utils/printConfigWarnings'
import { fixBinaryTargets } from './utils/fixBinaryTargets'
import { getBinaryPathsByVersion } from './utils/getBinaryPathsByVersion'
import { getEngineVersionForGenerator } from './utils/getEngineVersionForGenerator'
import { getOriginalBinaryTargetsValue, printGeneratorConfig } from './utils/printGeneratorConfig'

const debug = Debug('prisma:getGenerators')

type BinaryPathsOverride = {
  [P in EngineType]?: string
}

export type GeneratorRegistryEntry =
  | {
      type: 'rpc'
      generatorPath: string
      isNode?: boolean
    }
  | {
      type: 'in-process'
      generator: IGenerator
    }

export type GeneratorRegistry = Record<string, GeneratorRegistryEntry>

export type ProviderAliases = {
  [alias: string]: {
    generatorPath: string
    isNode?: boolean
  }
}

// From https://github.com/prisma/prisma/blob/eb4563aea6fb6e593ae48106a74f716ce3dc6752/packages/cli/src/Generate.ts#L167-L172
// versions are set like:
// version: enginesVersion,
// cliVersion: pkg.version,
export type GetGeneratorOptions = {
  /** @deprecated Pass a schemaContext instead. Kept for compatibility with prisma studio. */
  schemaPath?: string
  schemaContext?: SchemaContext
  registry: GeneratorRegistry
  /** @deprecated Use `registry` instead. Kept for compatibility with Prisma Studio. */
  providerAliases?: ProviderAliases
  version?: string
  printDownloadProgress?: boolean
  overrideGenerators?: GeneratorConfig[]
  skipDownload?: boolean
  binaryPathsOverride?: BinaryPathsOverride
  generatorNames?: string[]
  allowNoModels?: boolean
  typedSql?: SqlQueryOutput[]
  extensions?: {}
  cliCommand: string
}
/**
 * Makes sure that all generators have the binaries they deserve and returns a
 * `Generator` class per generator defined in the schema.prisma file.
 * In other words, this is basically a generator factory function.
 */
export async function getGenerators(options: GetGeneratorOptions): Promise<Generator[]> {
  // A hack for backward compatibility with Prisma Studio. Remove in Prisma 7.
  if (options.registry === undefined && options.providerAliases !== undefined) {
    options.registry = Object.fromEntries(
      Object.entries(options.providerAliases).map(([name, definition]) => [
        name,
        {
          type: 'rpc',
          generatorPath: definition.generatorPath,
          isNode: definition.isNode,
        } satisfies GeneratorRegistryEntry,
      ]),
    )
  }

  const {
    schemaPath,
    registry,
    version,
    printDownloadProgress,
    overrideGenerators,
    skipDownload,
    binaryPathsOverride,
    generatorNames = [],
    allowNoModels = true,
    typedSql,
  } = options
  // Fallback logic for prisma studio which still only passes a schema path
  const schemaContext =
    !options.schemaContext && schemaPath
      ? await loadSchemaContext({ schemaPath: { cliProvidedPath: schemaPath } })
      : options.schemaContext

  if (!schemaContext) {
    throw new Error(`no schema provided for getGenerators`)
  }

  if (!schemaContext.primaryDatasource) {
    throw new Error(missingDatasource)
  }

  printConfigWarnings(schemaContext.warnings)

  const dmmf = await getDMMF({ datamodel: schemaContext.schemaFiles })

  if (dmmf.datamodel.models.length === 0 && !allowNoModels) {
    // MongoDB needs extras for @id: @map("_id") @db.ObjectId
    if (schemaContext.primaryDatasource.provider === 'mongodb') {
      throw new Error(missingModelMessageMongoDB(options.cliCommand))
    }

    throw new Error(missingModelMessage(options.cliCommand))
  }

  const generatorConfigs = filterGenerators(overrideGenerators || schemaContext.generators, generatorNames)

  await validateGenerators(generatorConfigs)

  const runningGenerators: Generator[] = []
  try {
    // 1. Get all generators
    const generators = await pMap(
      generatorConfigs,
      async (generatorConfig, index) => {
        const baseDir = path.dirname(generatorConfig.sourceFilePath ?? schemaContext.schemaRootDir)

        // as of now mostly used by studio
        const providerValue = parseEnvValue(generatorConfig.provider)

        const generatorDefinition = registry[providerValue] ?? {
          type: 'rpc',
          generatorPath: providerValue,
        }

        const generatorInstance = match(generatorDefinition)
          .with({ type: 'in-process' }, ({ generator }) => new InProcessGenerator(generatorConfig, generator))
          .with(
            { type: 'rpc' },
            ({ generatorPath, isNode }) => new JsonRpcGenerator(generatorPath, generatorConfig, isNode),
          )
          .exhaustive()

        await generatorInstance.init()

        // resolve output path
        if (generatorConfig.output) {
          generatorConfig.output = {
            value: path.resolve(baseDir, parseEnvValue(generatorConfig.output)),
            fromEnvVar: null,
          }
          generatorConfig.isCustomOutput = true
        } else {
          if (!generatorInstance.manifest?.defaultOutput) {
            throw new Error(
              `Can't resolve output dir for generator ${bold(generatorConfig.name)} with provider ${bold(
                generatorConfig.provider.value!,
              )}.
You need to define \`output\` in the generator block in the schema file.`,
            )
          }

          generatorConfig.output = {
            value: await resolveOutput({
              defaultOutput: generatorInstance.manifest.defaultOutput,
              baseDir,
            }),
            fromEnvVar: null,
          }
        }

        const datamodel = mergeSchemas({ schemas: schemaContext.schemaFiles })

        const options: GeneratorOptions = {
          datamodel,
          datasources: schemaContext.datasources,
          generator: generatorConfig,
          dmmf,
          otherGenerators: skipIndex(generatorConfigs, index),
          schemaPath: schemaContext.schemaPath, // TODO:(schemaPath) can we get rid of schema path passing here?
          version: version || enginesVersion, // this version makes no sense anymore and should be ignored
          allowNoModels,
          typedSql,
        }

        // we set the options here a bit later after instantiating the Generator,
        // as we need the generator manifest to resolve the `output` dir
        generatorInstance.setOptions(options)

        runningGenerators.push(generatorInstance)

        return generatorInstance
      },
      {
        stopOnError: false, // needed so we can first make sure all generators are created properly, then cleaned up properly
      },
    )

    // 2. Check, if all required generators are there.
    // Generators can say in their "requiresGenerators" property in the manifest, which other generators they depend on
    // This has mostly been introduced for 3rd party generators, which rely on `prisma-client-js`.
    const generatorProviders: string[] = generatorConfigs.map((g) => parseEnvValue(g.provider))

    for (const g of generators) {
      if (g.manifest && g.manifest.requiresGenerators && g.manifest.requiresGenerators.length > 0) {
        for (const neededGenerator of g.manifest.requiresGenerators) {
          if (!generatorProviders.includes(neededGenerator)) {
            throw new Error(
              `Generator "${g.manifest.prettyName}" requires generator "${neededGenerator}", but it is missing in your schema.prisma.
Please add it to your schema.prisma:

generator gen {
  provider = "${neededGenerator}"
}
`,
            )
          }
        }
      }
    }

    // 3. Download all binaries and binary targets needed
    const neededVersions = Object.create(null)
    for (const g of generators) {
      if (
        g.manifest &&
        g.manifest.requiresEngines &&
        Array.isArray(g.manifest.requiresEngines) &&
        g.manifest.requiresEngines.length > 0
      ) {
        const neededVersion = getEngineVersionForGenerator(g.manifest, version)
        if (!neededVersions[neededVersion]) {
          neededVersions[neededVersion] = { engines: [], binaryTargets: [] }
        }

        for (const engine of g.manifest.requiresEngines) {
          if (!neededVersions[neededVersion].engines.includes(engine)) {
            neededVersions[neededVersion].engines.push(engine)
          }
        }

        const generatorBinaryTargets = g.options?.generator?.binaryTargets

        if (generatorBinaryTargets && generatorBinaryTargets.length > 0) {
          for (const binaryTarget of generatorBinaryTargets) {
            if (!neededVersions[neededVersion].binaryTargets.find((object) => object.value === binaryTarget.value)) {
              neededVersions[neededVersion].binaryTargets.push(binaryTarget)
            }
          }
        }
      }
    }

    debug('neededVersions', JSON.stringify(neededVersions, null, 2))
    const { binaryPathsByVersion } = await getBinaryPathsByVersion({
      neededVersions,
      // We're lazily computing the binary target here, to avoid printing the
      // `Prisma failed to detect the libssl/openssl version to use` warning
      // on StackBlitz, where the binary target is not detected.
      //
      // On other platforms, it's safe and fast to call this function again,
      // as its result is memoized anyway.
      detectBinaryTarget: getBinaryTargetForCurrentPlatform,
      version,
      printDownloadProgress,
      skipDownload,
      binaryPathsOverride,
    })
    for (const generator of generators) {
      if (generator.manifest && generator.manifest.requiresEngines) {
        const engineVersion = getEngineVersionForGenerator(generator.manifest, version)
        const binaryPaths = binaryPathsByVersion[engineVersion]
        // pick only the engines that we need for this generator
        const generatorBinaryPaths = pick(binaryPaths ?? {}, generator.manifest.requiresEngines)
        debug({ generatorBinaryPaths })
        generator.setBinaryPaths(generatorBinaryPaths)
      }
    }

    return generators
  } catch (e) {
    // make sure all generators that are already running are being stopped
    runningGenerators.forEach((g) => g.stop())
    throw e
  }
}

type NeededVersions = {
  [key: string]: {
    engines: EngineType[]
    binaryTargets: BinaryTargetsEnvValue[]
  }
}

export type GetBinaryPathsByVersionInput = {
  neededVersions: NeededVersions
  detectBinaryTarget: () => Promise<BinaryTarget>
  version?: string
  printDownloadProgress?: boolean
  skipDownload?: boolean
  binaryPathsOverride?: BinaryPathsOverride
}

/**
 * Shortcut for getGenerators, if there is only one generator defined. Useful for testing.
 * @param schemaPath path to schema.prisma
 * @param aliases Aliases like `photonjs` -> `node_modules/photonjs/gen.js`
 * @param version Version of the binary, commit hash of https://github.com/prisma/prisma-engine/commits/master
 * @param printDownloadProgress `boolean` to print download progress or not
 */
export async function getGenerator(options: GetGeneratorOptions): Promise<Generator> {
  const generators = await getGenerators(options)
  return generators[0]
}

export function skipIndex<T = any>(arr: T[], index: number): T[] {
  return [...arr.slice(0, index), ...arr.slice(index + 1)]
}

export const knownBinaryTargets: BinaryTarget[] = [...binaryTargets, 'native']

const oldToNewBinaryTargetsMapping = {
  'linux-glibc-libssl1.0.1': 'debian-openssl-1.0.x',
  'linux-glibc-libssl1.0.2': 'debian-openssl-1.0.x',
  'linux-glibc-libssl1.1.0': 'debian-openssl1.1.x',
}

async function validateGenerators(generators: GeneratorConfig[]): Promise<void> {
  const binaryTarget = await getBinaryTargetForCurrentPlatform()

  for (const generator of generators) {
    if (generator.binaryTargets) {
      const binaryTargets =
        generator.binaryTargets && generator.binaryTargets.length > 0
          ? generator.binaryTargets
          : [{ fromEnvVar: null, value: 'native' }]

      const resolvedBinaryTargets: string[] = binaryTargets
        .flatMap((object) => parseBinaryTargetsEnvValue(object))
        .map((p) => (p === 'native' ? binaryTarget : p))

      for (const resolvedBinaryTarget of resolvedBinaryTargets) {
        if (oldToNewBinaryTargetsMapping[resolvedBinaryTarget]) {
          throw new Error(
            `Binary target ${red(bold(resolvedBinaryTarget))} is deprecated. Please use ${green(
              bold(oldToNewBinaryTargetsMapping[resolvedBinaryTarget]),
            )} instead.`,
          )
        }
        if (!knownBinaryTargets.includes(resolvedBinaryTarget as BinaryTarget)) {
          throw new Error(
            `Unknown binary target ${red(resolvedBinaryTarget)} in generator ${bold(generator.name)}.
Possible binaryTargets: ${green(knownBinaryTargets.join(', '))}`,
          )
        }
      }

      // Only show warning if resolvedBinaryTargets
      // is missing current platform
      if (!resolvedBinaryTargets.includes(binaryTarget)) {
        const originalBinaryTargetsConfig = getOriginalBinaryTargetsValue(generator.binaryTargets)

        console.log(`${yellow('Warning:')} Your current platform \`${bold(
          binaryTarget,
        )}\` is not included in your generator's \`binaryTargets\` configuration ${JSON.stringify(
          originalBinaryTargetsConfig,
        )}.
To fix it, use this generator config in your ${bold('schema.prisma')}:
${green(
  printGeneratorConfig({
    ...generator,
    binaryTargets: fixBinaryTargets(generator.binaryTargets, binaryTarget),
  }),
)}
${gray(
  `Note, that by providing \`native\`, Prisma Client automatically resolves \`${binaryTarget}\`.
Read more about deploying Prisma Client: ${underline(
    'https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-schema/generators',
  )}`,
)}\n`)
      }
    }
  }
}

function filterGenerators(generators: GeneratorConfig[], generatorNames: string[]) {
  if (generatorNames.length < 1) {
    return generators
  }

  const filtered = generators.filter((generator) => generatorNames.includes(generator.name))

  if (filtered.length !== generatorNames.length) {
    const missings = generatorNames.filter((name) => filtered.find((generator) => generator.name === name) == null)
    const isSingular = missings.length <= 1
    throw new Error(
      `The ${isSingular ? 'generator' : 'generators'} ${bold(missings.join(', '))} specified via ${bold(
        '--generator',
      )} ${isSingular ? 'does' : 'do'} not exist in your Prisma schema`,
    )
  }

  return filtered
}
