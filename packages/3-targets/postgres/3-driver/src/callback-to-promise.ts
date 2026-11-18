/**
 * Wraps a Node-style callback function into a Promise.
 * Supports both (err) => void and (err, result) => void patterns.
 */
export function callbackToPromise(
  fn: (callback: (err: Error | null | undefined) => void) => void,
): Promise<void>;
export function callbackToPromise<T>(
  fn: (callback: (err: Error | null | undefined, result: T) => void) => void,
): Promise<T>;
export function callbackToPromise<T = void>(
  fn: (callback: (err: Error | null | undefined, result?: T) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    fn((err, result) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(result as T);
    });
  });
}
