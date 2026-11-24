interface Widget {
  readonly extra: string;
}
declare class Widget {
  readonly base: number;
}
declare function make(): Widget;
export { make };
