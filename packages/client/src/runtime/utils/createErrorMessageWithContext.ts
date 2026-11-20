import * as DMMF from '@prisma/dmmf'
import indentString from 'indent-string'
import { bold, dim, gray, red, underline } from 'kleur/colors'

import { CallSite, LocationInFile } from './CallSite'
import { SourceFileSlice } from './SourceFileSlice'

declare global {
  /**
   * a global variable that is injected by us via jest to make our snapshots
   * work in clients that cannot read from disk (e.g. wasm or edge clients)
   */
  let $getTemplateParameters: typeof getTemplateParameters | undefined
}

export interface ErrorArgs {
  callsite?: CallSite
  originalMethod: string
  message: string
  isPanic?: boolean
  showColors?: boolean
  callArguments?: string
}

type Colors = {
  red: (str: string) => string
  gray: (str: string) => string
  dim: (str: string) => string
  bold: (str: string) => string
  underline: (str: string) => string
  highlightSource: (source: SourceFileSlice) => SourceFileSlice
}

const colorsEnabled: Colors = {
  red,
  gray,
  dim,
  bold,
  underline,
  highlightSource: (source) => source.highlight(),
}

const colorsDisabled: Colors = {
  red: (str) => str,
  gray: (str) => str,
  dim: (str) => str,
  bold: (str) => str,
  underline: (str) => str,
  highlightSource: (source) => source,
}

type ErrorContextTemplateParameters = {
  functionName: string
  message: string
  location?: LocationInFile
  contextLines?: SourceFileSlice
  callArguments?: string
  isPanic: boolean
}

function getRawTemplateParameters({
  message,
  originalMethod,
  isPanic,
  callArguments,
}: ErrorArgs): ErrorContextTemplateParameters {
  return {
    functionName: `prisma.${originalMethod}()`,
    message,
    isPanic: isPanic ?? false,
    callArguments,
  }
}

export function getTemplateParameters(
  { callsite, message, originalMethod, isPanic, callArguments }: ErrorArgs,
  colors: Colors,
): ErrorContextTemplateParameters {
  const templateParameters = getRawTemplateParameters({ message, originalMethod, isPanic, callArguments })

  // @ts-ignore
  if (!callsite || typeof window !== 'undefined') {
    return templateParameters
  }

  if (process.env.NODE_ENV === 'production') {
    return templateParameters
  }

  const callLocation = callsite.getLocation()
  if (!callLocation || !callLocation.lineNumber || !callLocation.columnNumber) {
    return templateParameters
  }

  const contextFirstLine = Math.max(1, callLocation.lineNumber - 3)
  let source = SourceFileSlice.read(callLocation.fileName)?.slice(contextFirstLine, callLocation.lineNumber)
  const invocationLine = source?.lineAt(callLocation.lineNumber)
  if (source && invocationLine) {
    const invocationLineIndent = getIndent(invocationLine)
    const invocationCallCode = findPrismaActionCall(invocationLine)
    if (!invocationCallCode) {
      return templateParameters
    }
    templateParameters.functionName = `${invocationCallCode.code})`
    templateParameters.location = callLocation

    if (!isPanic) {
      source = source.mapLineAt(callLocation.lineNumber, (line) => line.slice(0, invocationCallCode.openingBraceIndex))
    }

    source = colors.highlightSource(source)
    const numberColumnWidth = String(source.lastLineNumber).length
    templateParameters.contextLines = source
      .mapLines((line, lineNumber) => colors.gray(String(lineNumber).padStart(numberColumnWidth)) + ' ' + line)
      .mapLines((line) => colors.dim(line))
      .prependSymbolAt(callLocation.lineNumber, colors.bold(colors.red('→')))

    if (callArguments) {
      let indentValue = invocationLineIndent + numberColumnWidth + 1 /* space between number and code */
      indentValue += 2 // arrow + space between arrow and number

      // indent all lines but first, because first line of the arguments will be printed
      // on the same line as the function call
      templateParameters.callArguments = indentString(callArguments, indentValue).slice(indentValue)
    }
  }
  return templateParameters
}

function findPrismaActionCall(str: string): { code: string; openingBraceIndex: number } | null {
  const allActions = Object.keys(DMMF.ModelAction).join('|')
  const regexp = new RegExp(String.raw`\.(${allActions})\(`)
  const match = regexp.exec(str)
  if (match) {
    const openingBraceIndex = match.index + match[0].length
    // to get the code we are slicing the string up to a found brace. We start
    // with first non-space character if space is found in the line before that or
    // 0 if it is not.
    const statementStart = str.lastIndexOf(' ', match.index) + 1
    return {
      code: str.slice(statementStart, openingBraceIndex),
      openingBraceIndex,
    }
  }
  return null
}

function getIndent(line: string): number {
  let spaceCount = 0
  for (let i = 0; i < line.length; i++) {
    if (line.charAt(i) !== ' ') {
      return spaceCount
    }
    spaceCount++
  }

  return spaceCount
}

function stringifyErrorMessage(
  { functionName, location, message, isPanic, contextLines, callArguments }: ErrorContextTemplateParameters,
  colors: Colors,
) {
  const lines: string[] = ['']

  const introSuffix = location ? ' in' : ':'
  if (isPanic) {
    lines.push(colors.red(`Oops, an unknown error occurred! This is ${colors.bold('on us')}, you did nothing wrong.`))
    lines.push(colors.red(`It occurred in the ${colors.bold(`\`${functionName}\``)} invocation${introSuffix}`))
  } else {
    lines.push(colors.red(`Invalid ${colors.bold(`\`${functionName}\``)} invocation${introSuffix}`))
  }

  if (location) {
    lines.push(colors.underline(stringifyLocationInFile(location)))
  }

  if (contextLines) {
    lines.push('')

    const contextLineParts = [contextLines.toString()]

    if (callArguments) {
      contextLineParts.push(callArguments)
      contextLineParts.push(colors.dim(')'))
    }
    lines.push(contextLineParts.join(''))
    if (callArguments) {
      lines.push('')
    }
  } else {
    lines.push('')
    if (callArguments) {
      lines.push(callArguments)
    }
    lines.push('')
  }

  lines.push(message)
  return lines.join('\n')
}

function stringifyLocationInFile(location: LocationInFile): string {
  const parts = [location.fileName]
  if (location.lineNumber) {
    parts.push(String(location.lineNumber))
  }

  if (location.columnNumber) {
    parts.push(String(location.columnNumber))
  }

  return parts.join(':')
}

export function createErrorMessageWithContext(args: ErrorArgs): string {
  const colors = args.showColors ? colorsEnabled : colorsDisabled
  let templateParameters: ErrorContextTemplateParameters

  if (TARGET_BUILD_TYPE === 'wasm-compiler-edge') {
    if (typeof $getTemplateParameters !== 'undefined') {
      templateParameters = $getTemplateParameters(args, colors)
    } else {
      templateParameters = getRawTemplateParameters(args)
    }
  } else {
    templateParameters = getTemplateParameters(args, colors)
  }

  return stringifyErrorMessage(templateParameters, colors)
}
