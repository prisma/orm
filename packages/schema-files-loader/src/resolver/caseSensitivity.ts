import { CaseSensitivityOptions } from './types'

export type FileNameToKeyMapper = (fileName: string) => string

export function createFileNameToKeyMapper(options: CaseSensitivityOptions): FileNameToKeyMapper {
  if (options.caseSensitive) {
    return (fileName) => fileName
  }
  return (fileName) => fileName.toLowerCase()
}
