declare global {
  interface Array<T> {
    shout(): string;
  }
}
declare function plain(): void;
export { plain };
