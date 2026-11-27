import { execFileSync } from 'node:child_process';

/**
 * Paths of committed JSON files that are not the repository's own contracts: the fixtures of every upgrade script's tests (synthetic, some in the old format), the old-format contract that tests the refusal, the hash inputs that hold each family's hash rules fixed (storage with no domain or hashes), and the files a past release stored, which keep the hashes that release computed.
 */
const notRepositoryContracts = [
  ':(exclude,glob)test/integration/test/upgrade-instructions/*/fixtures/**',
  ':!test/integration/test/fixtures/contract-format/supabase-before-dbgenerated-removal.contract.json',
  ':(exclude,glob)test/integration/test/fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys/prisma7-rc18-stored/**',
  ':(exclude,glob)**/test/fixtures/hash-rules/**',
  ':(exclude,glob)**/fixtures/release-candidate/**',
  ':(exclude,glob)test/integration/test/release-candidate-projects/fixtures/**',
  ':(exclude,glob)packages/3-targets/postgres/9-facade/test/fixtures/emitted-before-capabilities-by-version/**',
];

/** Every committed `*.json` file that may be one of the repository's own contracts, sorted. */
export function trackedContractCandidateFiles(repoRoot: string): readonly string[] {
  return execFileSync('git', ['ls-files', '-z', '--', '*.json', ...notRepositoryContracts], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\0')
    .filter((file) => file !== '')
    .sort();
}
