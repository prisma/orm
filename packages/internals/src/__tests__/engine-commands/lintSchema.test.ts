import { vitestConsoleContext, vitestContext } from '@prisma/get-platform/src/test-utils/vitestContext'
import { describe, expect, test } from 'vitest'

import { lintSchema } from '../../engine-commands'
import { getLintWarnings, LintError, LintWarning } from '../../engine-commands/lintSchema'
import { type MultipleSchemas } from '../../utils/schemaFileInput'

const ctx = vitestContext.new().add(vitestConsoleContext()).assemble()

describe('lint valid schema with a deprecated preview feature', () => {
  const schema = /* prisma */ `
    generator client {
      provider        = "prisma-client-js"
      previewFeatures = ["cockroachdb"]
    }

    datasource db {
      provider = "cockroachdb"
    }

    model SomeUser {
      id Int @id
    }
  `
  const schemas: MultipleSchemas = [['schema.prisma', schema]]

  const expectedWarning: LintWarning = {
    start: 91,
    end: 106,
    is_warning: true,
    text: `Preview feature "cockroachdb" is deprecated. The functionality can be used without specifying it as a preview feature.`,
  }

  test('should return a deprecated preview feature warning', () => {
    const lintDiagnostics = lintSchema({ schemas })

    expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.warn'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)

    expect(lintDiagnostics).toMatchObject([expectedWarning])

    const warnings = getLintWarnings(lintDiagnostics)
    expect(warnings).toMatchObject([expectedWarning])
  })
})

describe('lint invalid schema with a deprecated preview feature', () => {
  const schema = /* prisma */ `
    generator client {
      provider        = "prisma-client-js"
      previewFeatures = ["cockroachdb"]
    }

    datasource db {
      provider = "cockroachdb"
    }

    model SomeUser {
      id      Int      @id
      profile Profile?
    }

    model Profile {
      id     Int      @id
      user   SomeUser @relation(fields: [userId], references: [id], onUpdate: SetNull)
      userId Int      @unique
    }
  `
  const schemas: MultipleSchemas = [['schema.prisma', schema]]

  const expectedWarning: LintWarning = {
    start: 91,
    end: 106,
    is_warning: true,
    text: `Preview feature "cockroachdb" is deprecated. The functionality can be used without specifying it as a preview feature.`,
  }

  const expectedError: LintError = {
    start: 302,
    end: 383,
    is_warning: false,
    text: `Error parsing attribute "@relation": The \`onUpdate\` referential action of a relation must not be set to \`SetNull\` when a referenced field is required.
Either choose another referential action, or make the referenced fields optional.
`,
  }

  test('should return a parsing error and a deprecated preview feature warning', () => {
    const lintDiagnostics = lintSchema({ schemas })

    expect(ctx.mocked['console.log'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.warn'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)
    expect(ctx.mocked['console.error'].mock.calls.join('\n')).toMatchInlineSnapshot(`""`)

    expect(lintDiagnostics).toMatchObject([expectedError, expectedWarning])

    const warnings = getLintWarnings(lintDiagnostics)
    expect(warnings).toMatchObject([expectedWarning])
  })
})
