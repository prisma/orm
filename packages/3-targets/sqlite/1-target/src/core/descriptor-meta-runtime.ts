// Runtime-safe slice of the sqlite target descriptor metadata.
//
// This file exists separately from ./descriptor-meta on purpose: the runtime
// plane reads only `kind/familyId/targetId/id/version/capabilities/dataTypes`
// (plus the `__codecTypes` phantom). The `authoring` slot lives on the pack/control
// descriptor only, because authoring contributions are consumed at
// contract-construction time by `assembleAuthoringContributions` (control
// plane) and the PSL interpreter — never at runtime.
//
// Keeping the runtime closure free of the `./authoring` import is what lets
// the bundler tree-shake `@internal/family-sql/control` (and its
// transitive `verify-sql-schema` chunk) out of the runtime entry. Do not
// add an `authoring` field here — if you need to, the pack/control meta in
// `./descriptor-meta` is the right place. See TML-2766 for context.
import type { CodecTypes } from '../exports/codec-types';
import { sqliteDataTypes } from './data-types';

const sqliteTargetDescriptorMetaRuntimeBase = {
  kind: 'target',
  familyId: 'sql',
  targetId: 'sqlite',
  id: 'sqlite',
  version: '0.0.1',
  capabilities: {},
  dataTypes: sqliteDataTypes,
} as const;

export const sqliteTargetDescriptorMetaRuntime: typeof sqliteTargetDescriptorMetaRuntimeBase & {
  readonly __codecTypes?: CodecTypes;
} = sqliteTargetDescriptorMetaRuntimeBase;
