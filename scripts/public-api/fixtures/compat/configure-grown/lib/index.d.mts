interface Options {
  readonly a: string;
  readonly b: string;
}
declare function configure(options: Options, mode: "x"): void;
export { configure, type Options };
