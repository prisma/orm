#!/usr/bin/env node
// @ts-check
const streamConsumer = require('node:stream/consumers')
const fs = require('fs')

async function main() {
  const jobsToRun = []
  const stdinData = await streamConsumer.text(process.stdin)
  console.debug(`stdin: \`${stdinData}\``)
  const stdinDataTrimmed = stdinData.trim()
  console.debug(`stdin trimmed: \`${stdinDataTrimmed}\``)

  // If the stdin is empty, we run all jobs
  // It happens if the get-changed-files-action fails (e.g. if ran on a schedule)
  if (!stdinDataTrimmed) {
    console.log('Stdin is empty (expected some JSON as a string) - running all jobs as fallback.')
    jobsToRun.push('-all-')
  } else {
    /**
     * @type string[]
     **/
    const filesChanged = JSON.parse(stdinData)
    console.debug('filesChanged:', filesChanged)

    // If changes are located only in one of the paths below
    if (filesChanged.every((fileChanged) => fileChanged.startsWith('packages/cli/src/platform/'))) {
      jobsToRun.push('-cli-platform-')
    } else if (filesChanged.every((fileChanged) => fileChanged.startsWith('packages/cli/'))) {
      jobsToRun.push('-cli-')
      jobsToRun.push('-client-e2e-')
      if (filesChanged.some((fileChanged) => fileChanged.startsWith('packages/cli/src/platform/'))) {
        jobsToRun.push('-cli-platform-')
      }
    } else if (filesChanged.every((fileChanged) => fileChanged.startsWith('packages/client/'))) {
      jobsToRun.push('-client-')
      jobsToRun.push('-integration-tests-')
      jobsToRun.push('-cli-')
      jobsToRun.push('-client-e2e-')
    } else if (filesChanged.every((fileChanged) => fileChanged.startsWith('packages/integration-tests/'))) {
      jobsToRun.push('-integration-tests-')
    } else if (filesChanged.every((fileChanged) => fileChanged.startsWith('packages/migrate/'))) {
      jobsToRun.push('-migrate-')
      jobsToRun.push('-cli-')
      jobsToRun.push('-client-e2e-')
    } else if (filesChanged.every((fileChanged) => fileChanged.startsWith('packages/query-plan-executor/'))) {
      jobsToRun.push('-query-plan-executor-')
    } else {
      jobsToRun.push('-all-')
    }
  }

  console.log('jobsToRun:', jobsToRun)
  if (typeof process.env.GITHUB_OUTPUT == 'string' && process.env.GITHUB_OUTPUT.length > 0) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `jobs=${jobsToRun.join()}\n`)
    console.debug('jobsToRun added to GITHUB_OUTPUT')
  }
}

main().then(function () {
  console.log('Done')
})
