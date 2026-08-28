import type { JsonValue } from '@internal/contract/types';
import {
  type AuthoringEntityContext,
  type AuthoringEntityTypeDescriptor,
  type AuthoringEntityTypeNamespace,
  type AuthoringPslBlockDescriptorNamespace,
  type PslExtensionBlock,
  resolveEnumCodecId,
} from '@internal/framework-components/authoring';
import { blockAttribute, str } from '@internal/psl-parser';
import { type EnumTypeHandle, enumType } from '@internal/sql-contract-ts/contract-builder';
import { blindCast } from '@internal/utils/casts';

export const sqlFamilyEnumEntityDescriptor = {
  kind: 'entity' as const,
  discriminator: 'enum',
  output: {
    factory: (
      block: PslExtensionBlock,
      ctx: AuthoringEntityContext,
    ): EnumTypeHandle | undefined => {
      const sourceId = ctx.sourceId ?? 'unknown';
      const diagnostics = ctx.diagnostics;

      const resolved = resolveEnumCodecId(block, ctx);
      if (resolved === undefined) {
        return undefined;
      }
      const { codecId, codecSpan } = resolved;

      const nativeType = ctx.codecLookup?.targetTypesFor(codecId)?.[0];
      if (nativeType === undefined) {
        diagnostics?.push({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `enum "${block.name}" @@type references unknown codec "${codecId}"`,
          sourceId,
          span: codecSpan,
        });
        return undefined;
      }

      const codec = ctx.codecLookup?.get(codecId);
      if (codec === undefined) {
        diagnostics?.push({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `enum "${block.name}" @@type codec "${codecId}" resolves in targetTypesFor but is absent from codecLookup.get`,
          sourceId,
          span: codecSpan,
        });
        return undefined;
      }

      const seenValues = new Set<string>();
      const members: { name: string; value: unknown }[] = [];
      let memberError = false;

      for (const [memberName, paramValue] of Object.entries(block.parameters)) {
        let value: unknown;
        if (paramValue.kind === 'bare') {
          try {
            value = codec.decodeJson(memberName);
          } catch {
            diagnostics?.push({
              code: 'PSL_ENUM_BARE_MEMBER_NON_STRING_CODEC',
              message: `enum "${block.name}" member "${memberName}" has no value and codec "${codecId}" does not accept a bare name as input`,
              sourceId,
              span: paramValue.span,
            });
            memberError = true;
            continue;
          }
        } else if (paramValue.kind === 'value') {
          let jsonValue: unknown;
          try {
            jsonValue = JSON.parse(paramValue.raw);
          } catch {
            diagnostics?.push({
              code: 'PSL_EXTENSION_INVALID_VALUE',
              message: `enum "${block.name}" member "${memberName}" value "${paramValue.raw}" is not valid JSON`,
              sourceId,
              span: paramValue.span,
            });
            memberError = true;
            continue;
          }
          try {
            value = codec.decodeJson(
              blindCast<JsonValue, 'JSON.parse returns a JsonValue-compatible value'>(jsonValue),
            );
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            diagnostics?.push({
              code: 'PSL_EXTENSION_INVALID_VALUE',
              message: `enum "${block.name}" member "${memberName}" was rejected by codec "${codecId}": ${reason}`,
              sourceId,
              span: paramValue.span,
            });
            memberError = true;
            continue;
          }
        } else {
          continue;
        }

        const valueKey = String(value);
        if (seenValues.has(valueKey)) {
          diagnostics?.push({
            code: 'PSL_ENUM_DUPLICATE_MEMBER_VALUE',
            message: `enum "${block.name}": duplicate member value "${valueKey}"`,
            sourceId,
            span: paramValue.span,
          });
          memberError = true;
          continue;
        }
        seenValues.add(valueKey);
        members.push({ name: memberName, value });
      }

      if (memberError) return undefined;

      if (members.length === 0) {
        diagnostics?.push({
          code: 'PSL_ENUM_MISSING_TYPE',
          message: `enum "${block.name}" must have at least one member`,
          sourceId,
          span: block.span,
        });
        return undefined;
      }

      return enumType(
        block.name,
        { codecId, nativeType },
        ...members.map((m) => ({ name: m.name, value: m.value })),
      );
    },
  },
} satisfies AuthoringEntityTypeDescriptor;

export const sqlFamilyEntityTypes: AuthoringEntityTypeNamespace = {
  enum: sqlFamilyEnumEntityDescriptor,
};

const enumTypeBlockAttribute = blockAttribute('type', {
  positional: [{ key: 'codecId', type: str() }],
});

export const sqlFamilyPslBlockDescriptors = {
  enum: {
    kind: 'pslBlock',
    keyword: 'enum',
    discriminator: 'enum',
    name: { required: true },
    parameters: {},
    variadicParameters: true,
    attributes: { type: () => enumTypeBlockAttribute },
  },
} as const satisfies AuthoringPslBlockDescriptorNamespace;
