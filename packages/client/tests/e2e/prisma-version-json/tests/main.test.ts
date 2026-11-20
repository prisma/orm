import { execSync } from 'node:child_process'

import { expect, test } from 'vitest'

test('prisma version --json outputs valid JSON', () => {
  // Run prisma version --json | jq and check exit code
  // jq will exit with code 0 if JSON is valid, non-zero otherwise
  const output = execSync('pnpm exec prisma version --json | jq .', {
    encoding: 'utf-8',
    shell: '/bin/sh',
  })

  // additional check: verify that the output is valid JSON by parsing it
  const jsonOutput = output.trim()
  // verify it contains expected fields
  const parsed = JSON.parse(jsonOutput)
  expect(parsed).toHaveProperty('prisma')
})
