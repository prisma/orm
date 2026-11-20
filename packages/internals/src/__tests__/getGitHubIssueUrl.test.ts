import { stripVTControlCharacters } from 'node:util'

import { describe, expect, test } from 'vitest'

import { getGitHubIssueUrl } from '../utils/getGitHubIssueUrl'

describe('getErrorMessageWithLink', () => {
  test('basic serialization', () => {
    const message = getGitHubIssueUrl({
      title: 'This is a title',
      body: 'This is a body',
    })

    expect(stripVTControlCharacters(message)).toMatchInlineSnapshot(
      `"https://github.com/prisma/prisma/issues/new?body=This+is+a+body&title=This+is+a+title&template=bug_report.yml"`,
    )
  })
})
