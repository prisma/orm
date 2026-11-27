export declare abstract class Sequence {
  protected abstract [Symbol.iterator](): Iterator<string>;
  abstract [Symbol.asyncIterator](): AsyncIterator<string>;
}
