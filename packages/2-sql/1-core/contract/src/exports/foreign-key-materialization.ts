export {
  type ForeignKeyAuthoringInput,
  type MaterializedTableConstraints,
  materializeForeignKeysAndIndexes,
} from '../foreign-key-materialization';
export type { IndexCandidate } from '../index-deduplication';
export { derivedBackingIndexIsRedundant } from '../index-equivalence';
