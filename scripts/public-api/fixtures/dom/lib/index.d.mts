type Document = Record<string, unknown>;
interface Range {
  readonly start: number;
}
declare function read(range: Range): Document;
export { Document, Range, read };
