export interface ErrorWithBatchIndex {
  batchRequestIdx?: number
}

export function hasBatchIndex(value: object): value is Required<ErrorWithBatchIndex> {
  return typeof value['batchRequestIdx'] === 'number'
}
