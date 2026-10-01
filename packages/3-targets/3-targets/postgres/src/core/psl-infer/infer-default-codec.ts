/**
 * How `contract infer` checks that a default it writes reads back.
 *
 * `contract emit` reads the inferred schema with the stack's type constructors: the one a column's
 * type names gives the codec and its type parameters, and that codec reads the default. So infer
 * asks the same stack, which the SQL family hands it: it reads the type constructor call it writes
 * as the PSL reader does, and builds the codec from the stack's codec lookup.
 */

import type { ColumnDefaultLiteralInputValue, JsonValue } from '@internal/contract/types';
import type { SqlPslBuildContext } from '@internal/family-sql/control';
import {
  getAuthoringTypeConstructor,
  instantiateAuthoringTypeConstructor,
  validateAuthoringHelperArguments,
} from '@internal/framework-components/authoring';
import { type CodecRef, codecForRef, type DataTypeId } from '@internal/framework-components/codec';
import { parsePslPositionalArgs } from '@internal/psl-parser/interpret';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { isInternalError } from '@internal/utils/internal-error';
import { PG_TEXT_CODEC_ID } from '../codec-ids';

/** The type `contract infer` writes for a column: a PSL type name and the arguments of its type constructor call. */
export interface InferredPslType {
  readonly name: string;
  readonly args?: readonly string[];
}

/** What `contract infer` asks about a column's literal default. */
export interface InferredColumnDefaults {
  /** The data type the column's codec represents, which a default is written in. */
  dataTypeOf(pslType: InferredPslType, isEnum: boolean): DataTypeId | undefined;
  /** Whether the column's codec, built with the column's type parameters, reads the default back. */
  readsBack(
    value: ColumnDefaultLiteralInputValue,
    pslType: InferredPslType,
    isEnum: boolean,
    isList: boolean,
  ): boolean;
}

/**
 * The codec reference `contract emit` builds for a column of `pslType`: the codec its type
 * constructor names, with the type parameters the call's arguments give. An enum column's default
 * is a member name, which is text either way, so it reads through the text codec.
 */
function inferredCodecRef(
  context: SqlPslBuildContext,
  pslType: InferredPslType,
  isEnum: boolean,
): CodecRef | undefined {
  if (isEnum) return { codecId: PG_TEXT_CODEC_ID };
  const descriptor = getAuthoringTypeConstructor(context.authoringContributions, [pslType.name]);
  if (descriptor === undefined) return undefined;
  const args = parsePslPositionalArgs(descriptor.args ?? [], pslType.args ?? []);
  if (args === undefined) return undefined;
  validateAuthoringHelperArguments(pslType.name, descriptor.args, args);
  const { codecId, typeParams } = instantiateAuthoringTypeConstructor(descriptor, args);
  return {
    codecId,
    ...ifDefined(
      'typeParams',
      typeParams === undefined
        ? undefined
        : blindCast<JsonValue, 'type parameters instantiated from PSL arguments are JSON'>(
            typeParams,
          ),
    ),
  };
}

/**
 * The default checks for `context`. A default the codec refuses has no PSL literal, so the raw
 * expression prints instead of a schema `contract emit` would reject. A column whose codec cannot be
 * built with its type parameters is treated the same way. An `InternalError` is a bug, not a
 * refusal, so it passes through.
 *
 * A data type says which values its column takes, not that every codec of it accepts each one: the
 * temporal codecs represent types that cast from text but refuse `infinity`, which PostgreSQL stores
 * and reports verbatim.
 */
export function inferredColumnDefaults(context: SqlPslBuildContext): InferredColumnDefaults {
  return {
    dataTypeOf(pslType, isEnum) {
      try {
        const ref = inferredCodecRef(context, pslType, isEnum);
        return ref === undefined
          ? undefined
          : context.codecLookup.descriptorFor(ref.codecId)?.dataType;
      } catch (error) {
        if (isInternalError(error)) throw error;
        return undefined;
      }
    },
    readsBack(value, pslType, isEnum, isList) {
      const values = isList && Array.isArray(value) ? value : [value];
      try {
        const ref = inferredCodecRef(context, pslType, isEnum);
        const codec = ref === undefined ? undefined : codecForRef(context.codecLookup, ref);
        if (codec === undefined) return false;
        for (const element of values) {
          codec.decodeJson(blindCast<JsonValue, 'a stored literal default is JSON'>(element));
        }
        return true;
      } catch (error) {
        if (isInternalError(error)) throw error;
        return false;
      }
    },
  };
}

/** For a table whose columns have no literal default, such as a many-to-many junction table. */
export const noColumnDefaults: InferredColumnDefaults = {
  dataTypeOf: () => undefined,
  readsBack: () => false,
};
