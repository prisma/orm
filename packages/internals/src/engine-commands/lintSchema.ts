import type { MultipleSchemas } from '@prisma/get-dmmf'
import { yellow } from 'kleur/colors'

import { ErrorArea, getWasmError, RustPanic, WasmPanic } from '../panic'
import { prismaSchemaWasm } from '../wasm'

type LintSchemaParams = { schemas: MultipleSchemas }

type LintDiagnosticBase = {
  start: number
  end: number
  text: string
}

// nit: we could configure Serde to use camelCase these fields in Rust's JSON serialization
export type LintWarning = { is_warning: true } & LintDiagnosticBase
export type LintError = { is_warning: false } & LintDiagnosticBase
export type LintDiagnostic = LintWarning | LintError

/**
 * Diagnose the given schema, returning a list either errors or warnings.
 * This function may panic, but it won't throw any standard error.
 */
export function lintSchema({ schemas }: LintSchemaParams): LintDiagnostic[] {
  const lintResult = prismaSchemaWasm.lint(JSON.stringify(schemas))
  const lintDiagnostics = JSON.parse(lintResult) as LintDiagnostic[]
  return lintDiagnostics
}

export function handleLintPanic<T>(tryCb: () => T) {
  try {
    return tryCb()
  } catch (e: unknown) {
    const { message, stack } = getWasmError(e as WasmPanic)

    const panic = new RustPanic(
      /* message */ message,
      /* rustStack */ stack,
      /* request */ '@prisma/prisma-schema-wasm lint',
      ErrorArea.FMT_CLI,
    )

    throw panic
  }
}

export function getLintWarnings(lintDiagnostics: LintDiagnostic[]): LintWarning[] {
  return lintDiagnostics.filter(isWarning)
}

/*
 * Return warnings as a string, if any. So we can show them to the user.
 *
 * Note:
 * - We don't get a nice warning message output with colors and line numbers for free, as we would with errors detected by `getDmmf`.
 *   I.e., there's not such thing for warnings out of the box as the following:
 *     -->  schema.prisma:18
 *      |
 *   17 |   id     Int      @id
 *   18 |   user   SomeUser @relation(fields: [userId], references: [id], onUpdate: SetNull, onDelete: SetNull)
 *   19 |   userId Int      @unique
 *      |
 */
export function getLintWarningsAsText(lintDiagnostics: LintDiagnostic[]): string {
  const lintWarnings = getLintWarnings(lintDiagnostics)

  const textLines: string[] = []
  if (lintWarnings.length > 0) {
    textLines.push(yellow(`\nPrisma schema warning${lintWarnings.length > 1 ? 's' : ''}:`))
    for (const warning of lintWarnings) {
      textLines.push(warningToString(warning))
    }
  }

  return textLines.join('\n')
}

export function warningToString(warning: LintDiagnostic): string {
  return yellow(`- ${warning.text}`)
}

function isWarning(diagnostic: LintDiagnostic): diagnostic is LintWarning {
  return diagnostic.is_warning
}
