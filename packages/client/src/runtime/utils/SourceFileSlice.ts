import fs from 'fs'

import { highlightTS } from '../highlight/highlight'
import { dedent } from './dedent'

/**
 * Class represents a source code or it's slice.
 * Provides various methods for manipulating individual lines
 * of the files using original files line numbers, even if the file was
 * sliced
 */
export class SourceFileSlice {
  /**
   * First line, stored in the slice
   */
  readonly firstLineNumber: number
  private lines: string[]

  static read(filePath: string): SourceFileSlice | null {
    let content: string
    try {
      content = fs.readFileSync(filePath, 'utf-8')
    } catch (e) {
      return null
    }

    return SourceFileSlice.fromContent(content)
  }

  static fromContent(content: string): SourceFileSlice {
    const lines = content.split(/\r?\n/)

    return new SourceFileSlice(1, lines)
  }

  private constructor(firstLine: number, lines: string[]) {
    this.firstLineNumber = firstLine
    this.lines = lines
  }

  /**
   * First line, stored in the slice
   */
  get lastLineNumber(): number {
    return this.firstLineNumber + this.lines.length - 1
  }

  /**
   * Returns new `SourceFileLines` object, where specified
   * `lineNumber` is transformed, using provided `mapFn`
   * @param lineNumber
   * @param mapFn
   * @returns
   */
  mapLineAt(lineNumber: number, mapFn: (line: string) => string): SourceFileSlice {
    if (lineNumber < this.firstLineNumber || lineNumber > this.lastLineNumber) {
      return this
    }
    const idx = lineNumber - this.firstLineNumber
    const newLines = [...this.lines]
    newLines[idx] = mapFn(newLines[idx])
    return new SourceFileSlice(this.firstLineNumber, newLines)
  }

  /**
   * Returns new `SourceFileLines` object, where each line is transformed
   * with provided `mapFn` callback. Callback receives content of the line and
   * original line number
   * @param mapFn
   * @returns
   */
  mapLines(mapFn: (line: string, lineNumber: number) => string): SourceFileSlice {
    return new SourceFileSlice(
      this.firstLineNumber,
      this.lines.map((line, i) => mapFn(line, this.firstLineNumber + i)),
    )
  }

  /**
   * Returns contents of the specified line
   * @param lineNumber
   * @returns
   */
  lineAt(lineNumber: number): string | undefined {
    return this.lines[lineNumber - this.firstLineNumber]
  }

  /**
   * Prepends a character to the specified line and adds padding
   * to all the other lines so that they'll align
   * @param atLine
   * @param str
   * @returns
   */
  prependSymbolAt(atLine: number, str: string): SourceFileSlice {
    return this.mapLines((line, lineNumber) => {
      if (lineNumber === atLine) {
        return `${str} ${line}`
      }
      return `  ${line}`
    })
  }

  /**
   * Creates a new slice from a subset of specified lines of the new code
   * Lines of a slice can still be manipulated using their number in original file
   *
   * @example
   * ```ts
   * const slice = source.slice(80, 100)
   * slice.lineAt(80) === source.lineAt(80)
   * ```
   *
   * @param fromLine
   * @param toLine
   * @returns
   */
  slice(fromLine: number, toLine: number): SourceFileSlice {
    const clampedFrom = Math.max(fromLine, this.firstLineNumber)
    const clampedTo = Math.min(toLine, this.lastLineNumber)

    if (clampedFrom > clampedTo) {
      return new SourceFileSlice(fromLine, [])
    }

    const slicedLines = this.lines
      .slice(clampedFrom - this.firstLineNumber, clampedTo - this.firstLineNumber + 1)
      .join('\n')
    return new SourceFileSlice(clampedFrom, dedent(slicedLines).split('\n'))
  }

  /**
   * Returns new `SourceFileLines` object, where code inside of it have been
   * highlighted as typescript
   * @returns
   */
  highlight(): SourceFileSlice {
    const highlighted = highlightTS(this.toString())
    return new SourceFileSlice(this.firstLineNumber, highlighted.split('\n'))
  }

  toString(): string {
    return this.lines.join('\n')
  }
}
