import type { BindConfig, Connection, QueryParse } from 'pg';
import Cursor from 'pg-cursor';

let nextNamedPortalId = 1;

export interface NamedCursorOptions<Row> {
  readonly name: string;
  readonly text: string;
  readonly values: readonly unknown[];
  readonly config?: ConstructorParameters<typeof Cursor<Row>>[2];
}

// `parsedStatements` is set on the Connection by pg.Client, not by Connection
// itself, so it isn't declared on @types/pg's `Connection`.
type ConnectionWithStatementCache = Connection & {
  readonly parsedStatements: Record<string, string>;
};

// pg-cursor's runtime instance shape. @types/pg-cursor only declares the
// constructor + submit/read/close, so the fields pg-cursor sets on `this` and
// its handlers consume have to be re-declared here.
interface CursorInstanceFields {
  state: 'initialized' | 'submitted' | 'idle' | 'busy' | 'done' | 'error';
  connection: Connection | null;
  text: string;
  values: ReadonlyArray<unknown> | null;
  _portal: string;
  _conf: { types?: { getTypeParser: (oid: number, format?: string) => unknown } };
  _result: { _getTypeParser?: unknown };
  _ifNoData: () => void;
  _rowDescription: () => void;
}

/** Streaming cursor for a server-side named prepared statement. */
export class NamedCursor<Row = Record<string, unknown>> extends Cursor<Row> {
  readonly name: string;

  constructor(opts: NamedCursorOptions<Row>) {
    super(opts.text, [...opts.values], opts.config);
    this.name = opts.name;
    // Cursor declares `submit` as a property, not a class method, so
    // `override submit() {}` at the class level conflicts. Replace the
    // field on this instance instead.
    this.submit = this.submitNamed;
  }

  private submitNamed(connection: Connection): void {
    const self = this as unknown as CursorInstanceFields;
    const conn = connection as ConnectionWithStatementCache;

    self.state = 'submitted';
    self.connection = conn;
    self._portal = `np_${nextNamedPortalId++}`;

    if (!conn.parsedStatements[this.name]) {
      // QueryParse types `types` as required; pg's runtime accepts an empty
      // array (server infers parameter types).
      const parseMessage: QueryParse = { text: self.text, name: this.name, types: [] };
      conn.parse(parseMessage, true);
    }

    // pg-cursor's constructor pre-maps values via prepareValue, so the array
    // here is already wire-ready; the cast bridges pg-cursor's loose `any[]`
    // to BindConfig's stricter union.
    const bindMessage: BindConfig = {
      portal: self._portal,
      statement: this.name,
      values: (self.values ?? []) as BindConfig['values'],
    };
    conn.bind(bindMessage, true);

    conn.describe({ type: 'P', name: self._portal }, true);
    conn.flush();

    if (self._conf.types) {
      self._result._getTypeParser = self._conf.types.getTypeParser;
    }

    conn.once('noData', self._ifNoData);
    conn.once('rowDescription', self._rowDescription);
  }
}
