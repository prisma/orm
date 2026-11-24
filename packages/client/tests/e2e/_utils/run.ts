import os from 'node:os'
import { finished } from 'node:stream/promises'

import { arg } from '@prisma/internals'
import { createReadStream, existsSync } from 'fs'
import fs from 'fs/promises'
import glob from 'globby'
import path from 'path'
import { $, ProcessOutput, sleep } from 'zx'

const monorepoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..')
const e2eRoot = path.join(monorepoRoot, 'packages', 'client', 'tests', 'e2e')

const args = arg(
  process.argv.slice(2),
  {
    // see which commands are run and the outputs of the failures
    '--verbose': Boolean,
    // like run jest in band, useful for debugging and CI
    '--runInBand': Boolean,
    '--run-in-band': '--runInBand',
    // do not fully pack cli and client packages before packing
    '--skipPack': Boolean,
    '--skip-pack': '--skipPack',
    // a way to cleanup created files that also works on linux
    '--clean': Boolean,
    // number of workers to use for parallel tests
    '--maxWorkers': Number,
    '--max-workers': '--maxWorkers',
    // run only a subset of the tests, as "<index>/<count>" (1-based), to split
    // the suite across multiple CI machines. Tests are distributed round-robin.
    '--shard': String,
  },
  true,
  true,
)

async function main() {
  if (args instanceof Error) {
    console.log(args.message)
    process.exit(1)
  }

  args['--maxWorkers'] = args['--maxWorkers'] ?? os.cpus().length
  args['--runInBand'] = args['--runInBand'] ?? false
  args['--skipPack'] = args['--skipPack'] ?? false
  args['--verbose'] = args['--verbose'] ?? false
  args['--clean'] = args['--clean'] ?? false
  $.verbose = args['--verbose']

  if (args['--verbose'] === true) {
    await $`docker -v`
  }

  console.log('🧹 Cleaning up old files')
  if (args['--clean'] === true) {
    await $`docker compose -f ${__dirname}/docker-compose-clean.yml down --remove-orphans`
    await $`docker compose -f ${__dirname}/docker-compose-clean.yml up clean`
  }

  console.log('🎠 Preparing e2e tests')

  const packagesDir = path.join(monorepoRoot, 'packages')
  const allPackageFolderNames = (await fs.readdir(packagesDir)).filter((folderName) =>
    existsSync(path.join(packagesDir, folderName, 'package.json')),
  )
  const allPackageFolders = allPackageFolderNames.map((folderName) => path.join(packagesDir, folderName))
  const allPkgJsonPaths = allPackageFolders.map((packageFolder) => path.join(packageFolder, 'package.json'))
  const allPkgJson = allPkgJsonPaths.map(
    (packageJsonPath) =>
      require(packageJsonPath) as {
        name: string
        dependencies?: Record<string, string>
      },
  )
  const packedPackageFilename = (packageName: string) => `${packageName.replace(/^@/, '').replace('/', '-')}-0.0.0.tgz`

  const prismaTmpDir = path.join(os.homedir(), '.local', 'share', 'prisma-tmp')

  if (args['--skipPack'] === false) {
    // this process will need to modify some package.json, we save copies
    await $`pnpm -r exec cp package.json package.copy.json`

    // we prepare to replace references to local packages with their tarballs names
    const localPackageNames = allPkgJson.map((packageJson) => packageJson.name)

    // replace references to unbundled local packages with built and packaged tarballs
    for (let i = 0; i < allPkgJson.length; i++) {
      for (const key of Object.keys(allPkgJson[i].dependencies ?? {})) {
        if (localPackageNames.includes(key)) {
          allPkgJson[i].dependencies[key] = `/tmp/${packedPackageFilename(key)}`
        }
      }

      await fs.writeFile(allPkgJsonPaths[i], JSON.stringify(allPkgJson[i], null, 2))
    }

    await $`pnpm -r --parallel exec pnpm pack --pack-destination ${prismaTmpDir}/`
    await restoreOriginalState()
  }

  console.log('🐳 Starting tests in docker')
  // tarball was created, ready to send it to docker and begin e2e tests
  const testStepFiles = await glob(['../**/_steps.ts', '../**/_steps.cts'], { cwd: __dirname })
  let e2eTestNames = testStepFiles.map((p) => path.relative('..', path.dirname(p)))

  if (args._.length > 0) {
    e2eTestNames = e2eTestNames.filter((p) => args._.some((a) => p.includes(a)))
  }

  if (args['--shard'] !== undefined) {
    // Require an exact "<index>/<count>" so malformed values (e.g. "1/3/2")
    // error out instead of silently running the wrong shard.
    const shardMatch = /^(\d+)\/(\d+)$/.exec(args['--shard'])
    const shardIndex = Number(shardMatch?.[1])
    const shardCount = Number(shardMatch?.[2])

    if (shardMatch === null || shardCount < 1 || shardIndex < 1 || shardIndex > shardCount) {
      console.log(`🛑 Invalid --shard "${args['--shard']}", expected "<index>/<count>" with 1 <= index <= count`)
      process.exit(1)
    }

    // Sort first so shards are stable and disjoint regardless of glob order,
    // then distribute round-robin so slow tests don't cluster into one shard.
    e2eTestNames = [...e2eTestNames].sort().filter((_, i) => i % shardCount === shardIndex - 1)

    console.log(`🔀 Shard ${shardIndex}/${shardCount}: running ${e2eTestNames.length} test(s)`)
  }

  const dockerVolumeOptions = process.platform === 'linux' ? ':z' : ''
  const dockerVolume = (source: string, target: string) => `${source}:${target}${dockerVolumeOptions}`
  const dockerVolumes = [
    ...allPkgJson.map(({ name }) => {
      const filename = packedPackageFilename(name)
      return dockerVolume(`${prismaTmpDir}/${filename}`, `/tmp/${filename}`)
    }),
    dockerVolume(path.join(monorepoRoot, 'packages', 'engines'), '/engines'),
    dockerVolume(path.join(monorepoRoot, 'packages', 'client'), '/client'),
    dockerVolume(e2eRoot, '/e2e'),
    dockerVolume(path.join(e2eRoot, '.cache'), '/root/.cache'),
    dockerVolume((await $`pnpm store path`.quiet()).stdout.trim(), '/root/.local/share/pnpm/store/v3'),
  ]
  const dockerVolumeArgs = dockerVolumes.flatMap((v) => ['-v', v])

  await $`docker compose -f ${__dirname}/docker-compose.yaml build test-e2e`

  const dockerJobs = e2eTestNames.map((testPath) => {
    const composeFileArgs = ['-f', `${__dirname}/docker-compose.yaml`]
    const localComposePath = path.join(e2eRoot, testPath, 'docker-compose.yaml')
    if (existsSync(localComposePath)) {
      composeFileArgs.push('-f', localComposePath)
    }

    const projectName = testPath.toLocaleLowerCase().replace(/[^0-9a-z_-]/g, '-')
    const networkName = `${projectName}_default`
    return async () => {
      const result =
        await $`docker compose ${composeFileArgs} -p ${projectName} run --rm ${dockerVolumeArgs} -e "NAME=${testPath}" test-e2e`.nothrow()

      await $`docker compose ${composeFileArgs} -p ${projectName} logs > ${path.join(
        e2eRoot,
        testPath,
        'LOGS.docker.txt',
      )}`
      await $`docker compose ${composeFileArgs} -p ${projectName} stop`
      await $`docker compose ${composeFileArgs} -p ${projectName} rm -f`
      await $`docker network rm -f ${networkName}`
      return result
    }
  })

  const jobResults: (ProcessOutput & { name: string })[] = []
  if (args['--runInBand'] === true) {
    console.log('🏃 Running tests in band')
    for (const [i, job] of dockerJobs.entries()) {
      console.log(`💡 Running test ${i + 1}/${dockerJobs.length}`)
      jobResults.push(Object.assign(await job(), { name: e2eTestNames[i] }))
    }
  } else {
    console.log('🏃 Running tests in parallel')

    const pendingJobResults = [] as Promise<void>[]
    const semaphore = new Semaphore(args['--maxWorkers'])

    for (const [i, job] of dockerJobs.entries()) {
      await semaphore.acquire()

      const pendingJob = (async () => {
        console.log(`💡 Running test ${i + 1}/${dockerJobs.length}`)
        jobResults.push(Object.assign(await job(), { name: e2eTestNames[i] }))
      })()

      pendingJobResults.push(pendingJob.finally(() => semaphore.release()))
    }

    await Promise.allSettled(pendingJobResults)
  }

  const failedJobResults = jobResults.filter((r) => r.exitCode !== 0)
  const passedJobResults = jobResults.filter((r) => r.exitCode === 0)

  if (args['--verbose'] === true) {
    for (const result of failedJobResults) {
      console.log(`-----------------------------------------------------------------------`)
      console.log(`🛑🛑🛑 Test "${result.name}" failed with exit code ${result.exitCode} 🛑🛑🛑`)
      console.log(`\t\t⬇️ Container Log output below ⬇️\n\n`)
      console.log(`-----------------------------------------------------------------------`)

      const logsPath = path.resolve(__dirname, '..', result.name, 'LOGS.txt')
      const dockerLogsPath = path.resolve(__dirname, '..', result.name, 'LOGS.docker.txt')

      if (await isFile(logsPath)) {
        await printFile(logsPath)
      } else if (await isFile(dockerLogsPath)) {
        await printFile(dockerLogsPath)
      }
      await sleep(50) // give some time for the logs to be printed (CI issue)

      console.log(`-----------------------------------------------------------------------`)
      console.log(`🛑 ⬆️ Container Log output of test failure "${result.name}" above ⬆️ 🛑`)
      console.log(`-----------------------------------------------------------------------`)
    }
  }

  // let the tests run and gather a list of logs for containers that have failed
  if (failedJobResults.length > 0) {
    const failedJobLogPaths = failedJobResults.map((result) => path.resolve(__dirname, '..', result.name, 'LOGS.txt'))
    console.log(`-----------------------------------------------------------------------`)
    console.log(`✅ ${passedJobResults.length}/${jobResults.length} tests passed`)
    console.log(`🛑 ${failedJobResults.length}/${jobResults.length} tests failed`, failedJobLogPaths)

    throw new Error('Some tests exited with a non-zero exit code')
  } else {
    console.log(`-----------------------------------------------------------------------`)
    console.log(`✅ All ${passedJobResults.length}/${jobResults.length} tests passed`)
  }
}

async function restoreOriginalState() {
  if (args['--skipPack'] === false) {
    await $`pnpm -r exec cp package.copy.json package.json`
  }
}

async function printFile(filePath: string) {
  try {
    const fileStream = createReadStream(filePath)
    fileStream.pipe(process.stdout, { end: false })
    await finished(fileStream)
  } catch (err) {
    console.error(`Error trying to print log file "${filePath}":`, err)
  }
}

async function isFile(filePath: string) {
  try {
    const stat = await fs.stat(filePath)
    return stat.isFile()
  } catch (e) {
    if (e.code === 'ENOENT') {
      return false
    }
    throw e
  }
}

class Semaphore {
  #permits: number
  #waiting: Array<() => void> = []

  constructor(permits: number) {
    this.#permits = permits
  }

  async acquire(): Promise<void> {
    if (this.#permits > 0) {
      this.#permits--
    } else {
      await new Promise<void>((resolve) => this.#waiting.push(resolve))
    }
  }

  release(): void {
    if (this.#waiting.length > 0) {
      this.#waiting.shift()!()
    } else {
      this.#permits++
    }
  }
}

process.on('SIGINT', async () => {
  await restoreOriginalState()
  process.exit(0)
})

void main().catch((e) => {
  console.log(e)
  void restoreOriginalState()
  process.exit(1)
})
