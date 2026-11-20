import * as ts from '@prisma/ts-builders'

// @ts-ignore This doesn't currently work at build time when we don't have the `paths` set in `tsconfig.json`.
// Adding `@prisma/client` as a dev dependency leads to circular dependency issues.
// TODO: figure out if we can reuse the runtime types without moving all of them to the common package.
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
type RuntimeExport = keyof typeof import('@prisma/client/runtime/client') & string

export function runtimeImportedType(name: RuntimeExport): ts.NamedType {
  return ts.namedType(`runtime.${name}`)
}
