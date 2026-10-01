export {
  describeWeightGroupProblem,
  FULL_TEXT_INDEX_TYPE,
  type FullTextFieldsInput,
  type FullTextIndexDefinition,
  renderFullTextIndexExpression,
  weightGroupProblems,
  weightGroupsOf,
} from '../core/full-text-index-expression';
export { isFullTextIndexableCodec } from '../core/full-text-indexable-codecs';
export {
  escapeLiteral,
  qualifyName,
  quoteIdentifier,
  quoteQualifiedName,
  validateEnumValueLength,
} from '../core/sql-utils';
export { DEFAULT_FULL_TEXT_SEARCH_LANGUAGE } from '../core/text-search-languages';
