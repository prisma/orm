import { getCliDistributionIdentity } from '../utils/cli-distribution-identity'
import { parseCompletionCommand } from './Completions'

const result = parseCompletionCommand(process.argv.slice(3), getCliDistributionIdentity())

if (result instanceof Error) {
  console.error(result.message)
  process.exitCode = 1
} else {
  console.log(result)
}
