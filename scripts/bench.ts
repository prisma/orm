import { execaCommand } from 'execa'
import globby from 'globby'

async function main() {
  let benchmarks = await globby(['./packages/**/*.bench.ts', '!./packages/type-benchmark-tests/**'], {
    gitignore: true,
  })

  if (process.argv.length > 2) {
    const filterRegex = new RegExp(process.argv[2])
    benchmarks = benchmarks.filter((name) => filterRegex.test(name))

    if (benchmarks.length === 0) {
      throw new Error(`No benchmarks found that match the pattern ${filterRegex}`)
    }
  }

  await run(benchmarks)
}

async function run(benchmarks: string[]) {
  let failedCount = 0

  for (const location of benchmarks) {
    try {
      await execaCommand(`node -r esbuild-register ${location}`, {
        stdio: 'inherit',
      })
    } catch (e) {
      console.error(e)
      failedCount++
    }
  }

  if (failedCount > 0) {
    const pluralMarker = failedCount === 1 ? '' : 's'
    throw new Error(`${failedCount} benchmark${pluralMarker} failed`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
