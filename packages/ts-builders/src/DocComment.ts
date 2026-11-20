import { BasicBuilder } from './BasicBuilder'
import { Writer } from './Writer'

export class DocComment implements BasicBuilder {
  readonly lines: string[] = []

  constructor(startingText?: string) {
    if (startingText) {
      this.addText(startingText)
    }
  }

  addText(text: string): this {
    this.lines.push(...text.split('\n'))
    return this
  }

  write(writer: Writer) {
    writer.writeLine('/**')
    for (const line of this.lines) {
      writer.writeLine(` * ${line.replace(/\*\//g, '*\\/')}`)
    }
    writer.writeLine(' */')
    return writer
  }
}

function docComment(strings: TemplateStringsArray, ...args: string[]): DocComment
function docComment(startingText?: string): DocComment
function docComment(firstParameter: string | TemplateStringsArray | undefined, ...args: string[]): DocComment {
  if (typeof firstParameter === 'string' || typeof firstParameter === 'undefined') {
    return new DocComment(firstParameter)
  }
  return docCommentTag(firstParameter, args)
}

function docCommentTag(strings: TemplateStringsArray, args: string[]) {
  const docComment = new DocComment()
  const fullText = strings
    .flatMap((str, i) => {
      if (i < args.length) {
        return [str, args[i]]
      }
      return [str]
    })
    .join('')
  const lines = trimEmptyLines(fullText.split('\n'))
  if (lines.length === 0) {
    return docComment
  }
  const indent = getIndent(lines[0])
  for (const line of lines) {
    docComment.addText(line.slice(indent))
  }
  return docComment
}

function trimEmptyLines(lines: string[]): string[] {
  const firstLine = findFirstNonEmptyLine(lines)
  const lastLine = findLastNonEmptyLine(lines)
  if (firstLine === -1 || lastLine === -1) {
    // all lines are empty
    return []
  }
  return lines.slice(firstLine, lastLine + 1)
}

function findFirstNonEmptyLine(lines: string[]) {
  return lines.findIndex((line) => !isEmptyLine(line))
}

function findLastNonEmptyLine(lines: string[]) {
  let i = lines.length - 1
  while (i > 0 && isEmptyLine(lines[i])) {
    i--
  }
  return i
}

function isEmptyLine(line: string) {
  return line.trim().length === 0
}

function getIndent(line: string): number {
  let indent = 0
  while (line[indent] === ' ') {
    indent++
  }
  return indent
}

export { docComment }
