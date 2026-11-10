export { describeUnsupportedSqlAttribute } from '../psl-field-resolution';
/** Exported so declaration emit can name the arm types in the inferred type of `sqlAttributeSpecs`, and so a family can declare its default functions' signatures. */
export type {
  DefaultFunctionCall,
  DefaultFunctionSignature,
  EnumMemberDefault,
  EnumMemberListDefault,
  ParsedNullLiteral,
} from '../sql-attribute-specs';
export { defaultFunctionCall, sqlAttributeSpecs } from '../sql-attribute-specs';
