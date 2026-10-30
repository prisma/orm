import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import {
  type EnumBlockSite,
  enumMemberProblemDiagnostic,
} from '@internal/framework-components/authoring';
import type { BuildRefusal, FieldKey } from '@internal/mongo-contract-ts/contract-builder';
import type { PslSpan } from '@internal/psl-parser';
import { prisma6Diagnostic } from './diagnostics';

/** Where a part of a Prisma 6 schema is written. */
export interface IndexSite {
  readonly sourceId: string;
  readonly span: PslSpan;
}

export interface FieldSite extends IndexSite {
  readonly storedName: string;
}

export interface Prisma6Sites {
  readonly fields: Map<string, FieldSite>;
  /** Each model's indexes, in the order the definition lists them. */
  readonly indexes: Map<string, readonly IndexSite[]>;
  readonly enums: ReadonlyMap<string, EnumBlockSite>;
}

export function fieldSiteKey(model: string, field: string): string {
  return JSON.stringify([model, field]);
}

function fieldSiteOf(sites: Prisma6Sites, key: FieldKey): FieldSite | undefined {
  return sites.fields.get(fieldSiteKey(key.owner.name, key.field));
}

function unexplained(refusal: BuildRefusal, sourceId: string): ContractSourceDiagnostic {
  return prisma6Diagnostic(
    'PSL.PRISMA6_MONGO_CONTRACT_INVALID',
    `This schema gives a contract that Prisma 8 rejects (${refusal.kind}), and the Prisma 6 MongoDB contract source has no specific diagnostic for the cause. This is a bug in Prisma ORM; please report it with this schema.`,
    sourceId,
    undefined,
  );
}

/**
 * The reader's diagnostic for one refusal of the builder, at the place in the schema it is about. A refusal the reader cannot place is reported as a bug in the reader, as a contract Prisma 8 rejects.
 */
export function refusalDiagnostic(
  refusal: BuildRefusal,
  sites: Prisma6Sites,
  fallbackSourceId: string,
): ContractSourceDiagnostic {
  switch (refusal.kind) {
    case 'storedNameUnsupported': {
      const site = fieldSiteOf(sites, refusal.key);
      if (site === undefined) break;
      return {
        code: 'PSL_STORED_NAME_UNSUPPORTED',
        message: `Field "${refusal.key.owner.name}.${refusal.key.field}" ${refusal.reason}. Prisma 8 cannot read or write a field stored under that name.`,
        sourceId: site.sourceId,
        span: site.span,
      };
    }
    case 'storedNameDuplicate': {
      const site = fieldSiteOf(sites, refusal.key);
      if (site === undefined) break;
      const model = refusal.key.owner.name;
      return {
        code: 'PSL_DUPLICATE_STORED_NAME',
        message: `Fields "${model}.${refusal.firstField}" and "${model}.${refusal.key.field}" are both stored as "${refusal.storedName}".`,
        sourceId: site.sourceId,
        span: site.span,
      };
    }
    case 'indexShape': {
      const site = sites.indexes.get(refusal.key.model)?.[refusal.key.position];
      if (site === undefined || refusal.rule !== 'second-text-index') break;
      return prisma6Diagnostic(
        'PSL.PRISMA6_MONGO_TEXT_INDEX_LIMIT',
        `Model "${refusal.key.model}" has a @@fulltext, but another model stored in the same collection has one too; MongoDB allows one text index per collection. Merge the fields into one @@fulltext.`,
        site.sourceId,
        site.span,
      );
    }
    case 'indexDuplicate': {
      const site = sites.indexes.get(refusal.key.model)?.[refusal.key.position];
      if (site === undefined) break;
      return prisma6Diagnostic(
        'PSL.PRISMA6_MONGO_INDEX_ALREADY_EXISTS',
        refusal.firstModel === refusal.key.model
          ? `Model "${refusal.key.model}" has two indexes on the same fields that differ only in whether they write sort: Asc, which is the default sort. MongoDB holds them as one index, so the database cannot have both. Remove one of them.`
          : `Model "${refusal.key.model}" writes an index that model "${refusal.firstModel}" writes too, and both are stored in collection "${refusal.collection}". MongoDB cannot hold the same index twice in one collection. Remove it from one of the two models.`,
        site.sourceId,
        site.span,
      );
    }
    case 'generatedConflict': {
      const site = fieldSiteOf(sites, refusal.key);
      if (site === undefined) break;
      return prisma6Diagnostic(
        'PSL.PRISMA6_MONGO_GENERATED_VALUE_CONFLICT',
        `Field "${refusal.key.owner.name}.${refusal.key.field}" generates its value differently from "${refusal.otherModel}.${refusal.otherField}", which is stored in the same field "${site.storedName}" of collection "${refusal.collection}". Give both fields the same @default(now()) or @updatedAt.`,
        site.sourceId,
        site.span,
      );
    }
    case 'enumMemberProblem': {
      const site = sites.enums.get(refusal.enumName);
      if (site === undefined) break;
      return enumMemberProblemDiagnostic(refusal.problem, site);
    }
    default:
      break;
  }
  return unexplained(refusal, fallbackSourceId);
}
