import {
  type AnyFromSource,
  type AstRewriter,
  TableSource,
} from '@internal/sql-relational-core/ast';

export class PostgresTableSource extends TableSource {
  readonly schema: string | undefined;

  constructor(options: {
    readonly name: string;
    readonly schema?: string;
    readonly alias?: string;
  }) {
    super(options.name, options.alias);
    this.schema = options.schema;
    this.freeze();
  }

  override rewrite(rewriter: AstRewriter): AnyFromSource {
    return rewriter.tableSource ? rewriter.tableSource(this) : this;
  }
}
