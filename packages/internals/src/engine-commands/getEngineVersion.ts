import { BinaryType } from '@prisma/fetch-engine'
import { execa } from 'execa'
import * as TE from 'fp-ts/TaskEither'

import { resolveBinary } from '../resolveBinary'

export async function getEngineVersion(enginePath?: string, binaryName?: BinaryType): Promise<string> {
  enginePath = await resolveBinary(binaryName ?? BinaryType.SchemaEngineBinary, enginePath)

  const { stdout } = await execa(enginePath, ['--version'])
  return stdout
}

export function safeGetEngineVersion(enginePath?: string, binaryName?: BinaryType): TE.TaskEither<Error, string> {
  return TE.tryCatch(
    () => getEngineVersion(enginePath, binaryName),
    (error) => error as Error,
  )
}
