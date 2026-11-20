import { BinaryType, getBinaryEnvVarPath } from '@prisma/fetch-engine'
import * as E from 'fp-ts/Either'
import { pipe } from 'fp-ts/lib/function'
import * as O from 'fp-ts/Option'
import * as TE from 'fp-ts/TaskEither'
import path from 'path'
import { match, P } from 'ts-pattern'

import { safeResolveBinary } from '../resolveBinary'
import { safeGetEngineVersion } from './getEngineVersion'

/**
 * Both an engine binary and a library might be resolved from and environment variable indicating a path.
 * We first try to retrieve the engines' path from an env var; if it fails, we fall back to `safeResolveBinary`.
 * If both fail, we return an error.
 * Even if we resolve a path, retrieving the version might fail.
 */

export type EngineInfo = {
  fromEnvVar: O.Option<string>
  path: E.Either<Error, string>
  version: E.Either<Error, string>
}

export type BinaryMatrix<T> = {
  'schema-engine': T
}

export type BinaryInfoMatrix = BinaryMatrix<EngineInfo>

export function getEnginesInfo(enginesInfo: EngineInfo): readonly [string, Error[]] {
  // if the engine is not found, or the version cannot be retrieved, keep track of the resulting errors.
  const errors = [] as Error[]

  // compute message displayed when an engine is resolved via env vars
  const resolved = match(enginesInfo)
    .with({ fromEnvVar: P.when(O.isSome) }, (_engineInfo) => {
      return `, resolved by ${_engineInfo.fromEnvVar.value}`
    })
    .otherwise(() => '')

  // compute absolute path of an engine, returning an error message and populating
  // `errors` if it fails
  const absolutePath = match(enginesInfo)
    .with({ path: P.when(E.isRight) }, (_engineInfo) => {
      return _engineInfo.path.right
    })
    .with({ path: P.when(E.isLeft) }, (_engineInfo) => {
      // the binary/library can't be found
      errors.push(_engineInfo.path.left)
      return 'E_CANNOT_RESOLVE_PATH' as const
    })
    .exhaustive()

  // compute version (git hash) of an engine, returning an error message and populating
  // `errors` if it fails
  const version = match(enginesInfo)
    .with({ version: P.when(E.isRight) }, (_engineInfo) => {
      return _engineInfo.version.right
    })
    .with({ version: P.when(E.isLeft) }, (_engineInfo) => {
      // extracting the version failed
      errors.push(_engineInfo.version.left)
      return 'E_CANNOT_RESOLVE_VERSION' as const
    })
    .exhaustive()

  const versionMessage = `${version} (at ${path.relative(process.cwd(), absolutePath)}${resolved})`
  return [versionMessage, errors] as const
}

export async function resolveEngine(binaryName: BinaryType): Promise<EngineInfo> {
  const pathFromEnvOption = O.fromNullable(getBinaryEnvVarPath(binaryName))

  /**
   * Read the binary path, preferably from the environment, or resolving the canonical path
   * from the given `binaryName`.
   */

  const fromEnvVarOption: O.Option<string> = pipe(
    pathFromEnvOption,
    O.map((p) => p.fromEnvVar),
  )

  const enginePathEither: E.Either<Error, string> = await pipe(
    pathFromEnvOption,
    O.fold(
      () => safeResolveBinary(binaryName),
      (pathFromEnv) => TE.right(pathFromEnv.path),
    ),
  )()

  /**
   * Read the version from the engine, but only if the enginePath is valid.
   */

  const versionEither: E.Either<Error, string> = await pipe(
    enginePathEither,
    TE.fromEither,
    TE.chain((enginePath) => {
      return safeGetEngineVersion(enginePath, binaryName)
    }),
  )()

  const engineInfo: EngineInfo = {
    path: enginePathEither,
    version: versionEither,
    fromEnvVar: fromEnvVarOption,
  }

  return engineInfo
}
