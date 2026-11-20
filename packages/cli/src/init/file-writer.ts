import fs, { WriteFileOptions } from 'node:fs'
import path from 'node:path'

import { Format, GeneratedFiles } from './generated-files'

export class FileWriter {
  readonly #basePath: string
  readonly #files: GeneratedFiles

  constructor(basePath: string) {
    this.#basePath = basePath
    this.#files = new GeneratedFiles(basePath)
  }

  write(name: string, content: string | NodeJS.ArrayBufferView, options?: WriteFileOptions): void {
    const absPath = path.resolve(this.#basePath, name)
    fs.writeFileSync(absPath, content, options)
    this.#files.add(absPath)
  }

  format(f: Format): string {
    return this.#files.format(f)
  }
}
