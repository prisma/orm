import type { ContractEnum } from '@internal/contract/types';
import { encodeEnumMembers } from '@internal/framework-components/authoring';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import type { BuildRefusal } from './build-refusals';
import type { ContractDefinition } from './contract-definition';

/** Each enum with its members as its codec stores them. An enum the builder refuses is left out. */
export function buildEnums(
  definition: ContractDefinition,
  codecLookup: CodecLookupWithDescriptors,
  refusals: BuildRefusal[],
): Record<string, ContractEnum> {
  const builtEnums: Record<string, ContractEnum> = {};
  for (const [enumName, handle] of Object.entries(definition.enums ?? {})) {
    const encoded = encodeEnumMembers(handle, codecLookup);
    if (!encoded.ok) {
      for (const problem of encoded.failure) {
        refusals.push({
          kind: 'enumMemberProblem',
          key:
            'member' in problem
              ? { kind: 'enumMember', enumName, member: problem.member }
              : { kind: 'enum', enumName },
          enumName: handle.enumName,
          codecId: handle.codecId,
          problem,
        });
      }
      continue;
    }
    builtEnums[enumName] = { codecId: handle.codecId, members: encoded.value };
  }
  for (const [enumName, handle] of Object.entries(definition.enums ?? {})) {
    if (enumName !== handle.enumName) {
      refusals.push({
        kind: 'enumKeyMismatch',
        key: { kind: 'enum', enumName },
        enumName: handle.enumName,
      });
    }
  }
  return builtEnums;
}
