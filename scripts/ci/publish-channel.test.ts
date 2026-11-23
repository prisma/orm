/* eslint-disable @typescript-eslint/no-floating-promises -- node:test tracks the promises that describe() and test() return */

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  getNextMinorStable,
  getPackageDistTag,
  getPublishChannel,
  parseCustomDistTag,
  PRISMA_CLI_OWNED_DIST_TAGS,
  type PublishChannel,
  type PublishChannelInput,
} from './publish-channel'

const push: PublishChannelInput = {
  branch: 'v7',
  patchBranch: null,
  releaseVersion: undefined,
  forceIntegrationRelease: false,
}

describe('getPublishChannel', () => {
  const cases: [string, PublishChannelInput, PublishChannel][] = [
    ['push to v7', push, { kind: 'dev', tag: 'dev' }],
    [
      '--release on v7',
      { ...push, releaseVersion: '7.11.0' },
      { kind: 'release', tag: 'latest', ecosystemTestsBranch: 'dev' },
    ],
    [
      'push to a patch branch',
      { ...push, branch: '7.9.x', patchBranch: '7.9.x' },
      { kind: 'patch-dev', tag: 'patch-dev' },
    ],
    [
      '--release on a patch branch',
      { ...push, branch: '7.9.x', patchBranch: '7.9.x', releaseVersion: '7.9.2' },
      { kind: 'release', tag: 'latest', ecosystemTestsBranch: 'patch-dev' },
    ],
    ['push to integration/*', { ...push, branch: 'integration/foo' }, { kind: 'integration', tag: 'integration' }],
    [
      'forced integration release wins over --release',
      { ...push, forceIntegrationRelease: true, releaseVersion: '7.11.0' },
      { kind: 'integration', tag: 'integration' },
    ],
  ]

  for (const [name, input, expected] of cases) {
    test(name, () => {
      assert.deepEqual(getPublishChannel(input), expected)
    })
  }
})

describe('getPackageDistTag', () => {
  const cases: [string, string, string][] = [
    ['prisma', 'dev', 'prev-dev'],
    ['@prisma/client', 'dev', 'dev'],
    ['prisma', 'latest', 'prev'],
    ['@prisma/client', 'latest', 'latest'],
    ['prisma', 'prev', 'prev'],
    ['prisma', 'prev-dev', 'prev-dev'],
    ['prisma', 'patch-dev', 'patch-dev'],
    ['prisma', 'integration', 'integration'],
    ['prisma', 'my-custom-tag', 'my-custom-tag'],
    ['@prisma/client', 'next', 'next'],
  ]

  for (const [pkgName, tag, expected] of cases) {
    test(`${pkgName} on ${tag} publishes under ${expected}`, () => {
      assert.equal(getPackageDistTag(pkgName, tag), expected)
    })
  }

  test('refuses to publish prisma under next', () => {
    assert.throws(() => getPackageDistTag('prisma', 'next'), /prisma\/prisma-cli owns it/)
  })

  test('never publishes prisma under a tag prisma/prisma-cli owns', () => {
    const runTags = [...new Set([...cases.map(([, tag]) => tag), ...PRISMA_CLI_OWNED_DIST_TAGS])]
    for (const runTag of runTags) {
      let prismaTag: string
      try {
        prismaTag = getPackageDistTag('prisma', runTag)
      } catch {
        continue
      }
      assert.ok(!PRISMA_CLI_OWNED_DIST_TAGS.has(prismaTag), `${runTag} put prisma on ${prismaTag}`)
    }
  })
})

describe('parseCustomDistTag', () => {
  test('removes the whitespace a shell would drop', () => {
    assert.equal(parseCustomDistTag(' next'), 'next')
    assert.equal(parseCustomDistTag('dev '), 'dev')
  })

  test('a padded prisma-cli tag still maps for prisma', () => {
    assert.equal(getPackageDistTag('prisma', parseCustomDistTag(' dev ')), 'prev-dev')
    assert.throws(() => getPackageDistTag('prisma', parseCustomDistTag(' next ')), /prisma\/prisma-cli owns it/)
  })

  for (const input of ['', 'my tag', 'Dev', 'dev;next', '--tag']) {
    test(`refuses ${JSON.stringify(input)}`, () => {
      assert.throws(() => parseCustomDistTag(input), /not a usable npm dist-tag/)
    })
  }
})

describe('getNextMinorStable', () => {
  test('returns the next minor after the highest stable 7.x version', () => {
    assert.equal(getNextMinorStable(['7.9.0', '7.10.0', '7.10.1', '7.10.0-dev.58']), '7.11.0')
  })

  test('uses the highest version, not the newest one in the list', () => {
    assert.equal(getNextMinorStable(['7.10.1', '7.9.2']), '7.11.0')
  })

  test('ignores other majors and prereleases', () => {
    assert.equal(
      getNextMinorStable(['6.19.3', '7.10.1', '7.11.0-dev.1', '7.12.0-integration-foo.1', '8.0.0', '8.0.0-rc.34']),
      '7.11.0',
    )
  })

  test('throws when no stable 7.x version exists', () => {
    for (const versions of [[], ['6.19.3', '8.0.0', '7.11.0-dev.1', '7.10']]) {
      assert.throws(() => getNextMinorStable(versions), /no stable 7\.x\.y version of prisma/)
    }
  })
})
