import { PrismaClientValidationError } from '@prisma/client-runtime-utils'

import { ErrorFormat } from '../../getPrismaClient'
import { CallSite } from '../../utils/CallSite'
import { createErrorMessageWithContext } from '../../utils/createErrorMessageWithContext'
import { GlobalOmitOptions } from '../jsonProtocol/serializeJsonQuery'
import { JsArgs } from '../types/exported/JsApi'
import { ValidationError } from '../types/ValidationError'
import { applyValidationError } from './applyValidationError'
import { buildArgumentsRenderingTree, renderArgsTree } from './ArgumentsRenderingTree'

type ExceptionParams = {
  errors: ValidationError[]
  args: JsArgs
  callsite?: CallSite
  originalMethod: string
  errorFormat: ErrorFormat
  clientVersion: string
  globalOmit?: GlobalOmitOptions
}

export function throwValidationException({
  args,
  errors,
  errorFormat,
  callsite,
  originalMethod,
  clientVersion,
  globalOmit,
}: ExceptionParams): never {
  const argsTree = buildArgumentsRenderingTree(args)
  for (const error of errors) {
    applyValidationError(error, argsTree, globalOmit)
  }

  const { message, args: renderedArgs } = renderArgsTree(argsTree, errorFormat)

  const messageWithContext = createErrorMessageWithContext({
    message,
    callsite,
    originalMethod,
    showColors: errorFormat === 'pretty',
    callArguments: renderedArgs,
  })

  throw new PrismaClientValidationError(messageWithContext, { clientVersion })
}
