import fs from 'node:fs'
import path from 'node:path'

import { arg } from '@prisma/internals'

import { AdapterProviders, isDriverAdapterProviderLabel, Providers } from '../../tests/functional/_utils/providers'
import { JestCli } from './JestCli'

const allProviders = new Set(Object.values(Providers))
const allAdapterProviders = new Set(Object.values(AdapterProviders))

// See https://jestjs.io/docs/cli
// Not all Jest params are defined below
// If one is missing and you want to use it, you can add it
const jestArgs = {
  // Whether to use the cache. Defaults to true. Disable the cache using --no-cache.
  '--cache': Boolean,
  '--no-cache': Boolean,
  // Passes the same flag to Jest to only run tests related to changed files
  '--changedFilesWithAncestor': Boolean,
  // Passes the same flag to Jest to only run tests related to changed files
  '--changedSince': String,
  // Passes the same flag to Jest to only run tests related to changed files
  '--onlyChanged': Boolean,
  // Run all tests affected by file changes in the last commit made. Behaves similarly to --onlyChanged.
  '--lastCommit': Boolean,
  // Deletes the Jest cache directory and then exits without running tests.
  '--clearCache': Boolean,
  // Print debugging info about your Jest config.
  '--debug': Boolean,
  // Print the remaining open handles preventing Jest from exiting, implies `--runInBand`.
  '--detectOpenHandles': Boolean,
  // Use this flag to show full diffs and errors instead of a patch.
  '--expand': Boolean,
  '-e': '--expand',
  // Create json test report -a lso see --outputFile.
  '--json': Boolean,
  // Lists all test files that Jest will run given the arguments, and exits.
  '--listTests': Boolean,
  // Lists all test files that Jest will run given the arguments, and exits.
  '--logHeapUsage': Boolean,
  // Logs the heap usage after every test. Useful to debug memory leaks. Use together with --runInBand and --expose-gc in node.
  // Prevents Jest from executing more than the specified amount of tests at the same time. Only affects tests that use test.concurrent.
  '--maxConcurrency': Number,
  // Specifies the maximum number of workers the worker-pool will spawn for running tests.
  '--maxWorkers': Number || String,
  '-w': '--maxWorkers',
  // Disables stack trace in test results output.
  '--noStackTrace': Boolean,
  // Activates notifications for test results.
  '--notify': Boolean,
  // Passes the same flag to Jest to shard tests between multiple machines
  '--shard': String,
  // Passes the same flag to Jest to silence the output
  '--silent': Boolean,
  // Tell Jest to run tests sequentially
  '--runInBand': Boolean,
  // Print your Jest config and then exits.
  '--showConfig': Boolean,
  // Run only tests with a name that matches the regex.
  '--testNamePattern': String,
  '-t': '--testNamePattern',
  // Divert all output to stderr.
  '--useStderr': Boolean,
  // Display individual test results with the test suite hierarchy.
  '--verbose': Boolean,
  // Watch files for changes and rerun tests related to changed files. If you want to re-run all tests when a file has changed, use the --watchAll option instead.
  '--watch': Boolean,
  // Watch files for changes and rerun all tests when something changes. If you want to re-run only the tests that depend on the changed files, use the --watch option.
  '--watchAll': Boolean,
  // Whether to use worker threads for parallelization. Child processes are used by default.
  '--workerThreads': Boolean,
}

const args = arg(
  process.argv.slice(2),
  {
    // Update snapshots
    '--updateSnapshot': Boolean,
    '-u': '--updateSnapshot',
    // Only run the tests, don't typecheck
    '--no-types': Boolean,
    // Only typecheck, don't run the code tests
    '--types-only': Boolean,
    // Generates all the clients to run the type tests
    '--generate-only': Boolean,
    // Restrict the list of providers (does not run --adapter by default)
    '--provider': [String],
    '-p': '--provider',
    // Force using a specific client runtime under the hood
    '--client-runtime': String,
    // Force using a specific generator type (prisma-client-js or prisma-client-ts)
    '--generator-type': String,
    // Since `relationMode-in-separate-gh-action` tests need to be run with 2 different values
    // `foreignKeys` and `prisma`
    // We run them separately in a GitHub Action matrix for now
    // Also the typescript tests fail and it might not be easily fixable
    // This flag is used for this purpose
    '--relation-mode-tests-only': Boolean,
    // Run tests for specific provider adapters (and excludes regular provider tests)
    '--adapter': [String],
    // Use client engine's remote executor
    '--remote-executor': Boolean,
    // Forces any given test to be run with an *added* set of preview features, comma-separated
    '--preview-features': String,
    // Enable Node.js debugger
    '--inspect-brk': Boolean,

    //
    // Jest params
    //
    ...jestArgs,
  },
  false,
  true,
)

if (args instanceof Error) {
  throw args
}

function main(): number | void {
  const jestCliBase = new JestCli(['--config', 'tests/functional/jest.config.js'])
  let jestCli = jestCliBase
  // Pass all the Jest params to Jest CLI
  for (const cliArg of Object.keys(args)) {
    // If it's a boolean, we only need to pass the flag
    if (typeof jestArgs[cliArg] === 'function' && jestArgs[cliArg].name === 'Boolean') {
      jestCli = jestCli.withArgs([cliArg])
    } else if (jestArgs[cliArg]) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      jestCli = jestCli.withArgs([cliArg, args[cliArg]])
    }
  }

  if (args['--inspect-brk']) {
    jestCli = jestCli.withDebugger()
  }

  if (args['--preview-features']) {
    jestCli = jestCli.withEnv({ TEST_PREVIEW_FEATURES: args['--preview-features'] })
  }

  if (args['--provider']) {
    const providers = args['--provider'] as Providers[]
    const unknownProviders = providers.filter((provider) => !allProviders.has(provider))
    if (unknownProviders.length > 0) {
      throw new Error(`Unknown providers: ${unknownProviders.join(', ')}`)
    }
    jestCli = jestCli.withEnv({ ONLY_TEST_PROVIDERS: providers.join(',') })
  }

  if (args['--adapter']) {
    const adapterProviders = args['--adapter'] as AdapterProviders[]
    const unknownAdapterProviders = adapterProviders.filter(
      (adapterProvider) => !allAdapterProviders.has(adapterProvider),
    )

    if (unknownAdapterProviders.length > 0) {
      const allAdaptersStr = Array.from(allAdapterProviders)
        .map((provider) => `  - ${provider}`)
        .join('\n')
      throw new Error(
        `Unknown adapter providers: ${unknownAdapterProviders.join(', ')}. Available options:\n${allAdaptersStr}\n\n`,
      )
    }

    if (adapterProviders.some(isDriverAdapterProviderLabel)) {
      // Locally, running D1 tests accumulates a lot of data in the .wrangler directory.
      // Because we cannot reset the database contents programmatically at the moment,
      // deleting it is the easy way
      // It makes local tests consistently fast and clean
      fs.rmSync(path.join(__dirname, '..', '..', '.wrangler'), { recursive: true, force: true })

      jestCli = jestCli.withArgs(['--runInBand'])
      jestCli = jestCli.withEnv({ PRISMA_DISABLE_QUAINT_EXECUTORS: 'true' })
      jestCli = jestCli.withEnv({ TEST_REUSE_DATABASE: 'true' })
    }

    jestCli = jestCli.withEnv({ ONLY_TEST_PROVIDER_ADAPTERS: adapterProviders.join(',') })
  }

  if (args['--client-runtime']) {
    jestCli = jestCli.withEnv({ TEST_CLIENT_RUNTIME: args['--client-runtime'] })
  }

  if (args['--generator-type']) {
    jestCli = jestCli.withEnv({ TEST_GENERATOR_TYPE: args['--generator-type'] })
  }

  if (args['--remote-executor']) {
    jestCli = jestCli.withEnv({
      TEST_CLIENT_ENGINE_REMOTE_EXECUTOR: 'true',
    })
  }

  // See flag description above.
  // If the flag is not provided we want to ignore `relationMode` tests
  if (args['--relation-mode-tests-only']) {
    jestCli = jestCli.withArgs(['--runInBand'])
    jestCli = jestCli.withEnv({ TEST_REUSE_DATABASE: 'true' })
  } else {
    jestCli = jestCli.withArgs(['--testPathIgnorePatterns', 'relationMode-in-separate-gh-action'])
  }

  try {
    if (args['--updateSnapshot']) {
      const snapshotUpdate = jestCli
        .withArgs(['-u'])
        .withArgs(['--testPathIgnorePatterns', 'typescript', '--', args['_']])
      snapshotUpdate.withEnv({ UPDATE_SNAPSHOTS: 'inline' }).run()
      snapshotUpdate.withEnv({ UPDATE_SNAPSHOTS: 'external' }).run()
    } else {
      if (!args['--types-only']) {
        jestCli
          .withArgs(['--testPathIgnorePatterns', 'typescript', '--', args['_']])
          .withEnv({ TEST_GENERATE_ONLY: args['--generate-only'] ? 'true' : 'false' })
          .run()
      }

      if (!args['--no-types']) {
        // Disable JUnit output for typescript tests
        jestCliBase.withArgs(['--', 'typescript']).withEnv({ JEST_JUNIT_DISABLE: 'true' }).run()
      }
    }
  } catch (error) {
    if (error.exitCode) {
      // If it's execa error, exit without logging: we
      // already have output from jest
      return error.exitCode
    }
    throw error
  }
}

const code = main()
if (code) {
  process.exit(code)
}
