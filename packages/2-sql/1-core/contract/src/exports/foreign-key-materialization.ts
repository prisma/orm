export {
  declaredBackingObjectName,
  declaredIndexesServeForeignKey,
  FOREIGN_KEY_INDEX_UNRESOLVED,
  type ForeignKeyAuthoringInput,
  type MaterializedTableConstraints,
  materializeForeignKeysAndIndexes,
} from '../foreign-key-materialization';
export type { IndexCandidate } from '../index-deduplication';
export {
  derivedBackingIndexIsRedundant,
  leadingBackingObjectName,
} from '../index-equivalence';
