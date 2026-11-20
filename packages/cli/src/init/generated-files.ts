import path from 'node:path'

export class GeneratedFiles {
  readonly #basePath: string
  readonly #children = new Map<string, GeneratedFiles>()

  constructor(basePath: string) {
    this.#basePath = basePath
  }

  add(file: string): void {
    if (file === this.#basePath) {
      return
    }
    const relPath = path.relative(this.#basePath, file)
    const [firstSegment] = relPath.split(path.sep, 1)
    this.#entry(firstSegment).add(file)
  }

  #entry(name: string): GeneratedFiles {
    let entry = this.#children.get(name)
    if (!entry) {
      entry = new GeneratedFiles(path.join(this.#basePath, name))
      this.#children.set(name, entry)
    }
    return entry
  }

  header(): string {
    const header = path.basename(this.#basePath)
    if (this.#children.size === 0) {
      return header
    } else {
      return `${header}/`
    }
  }

  *entries(): Iterable<GeneratedFiles> {
    for (const entry of this.#children.values()) {
      yield entry
    }
  }

  format(f: Format): string {
    return new Formatter(this, f).formatToString()
  }
}

export interface Format {
  readonly level: number
  readonly printHeadersFromLevel: number
  readonly indentSize: number
}

class Formatter {
  readonly #files: GeneratedFiles
  readonly #format: Format

  constructor(files: GeneratedFiles, format: Format) {
    this.#files = files
    this.#format = format
  }

  formatToString(): string {
    return this.formatLines().join('\n')
  }

  formatLines(): string[] {
    const lines: string[] = []

    if (this.#format.level >= this.#format.printHeadersFromLevel) {
      lines.push(this.#indent(this.#files.header()))
    }

    for (const entry of this.#files.entries()) {
      const formatter = new Formatter(entry, { ...this.#format, level: this.#format.level + 1 })
      lines.push(...formatter.formatLines())
    }

    return lines
  }

  #indent(line: string): string {
    const indent = ' '.repeat(this.#format.indentSize * this.#format.level)
    return `${indent}${line}`
  }
}
