import { DataRule, ValidationError } from '../query-plan'
import { UserFacingError } from '../user-facing-error'
import { assertNever, DeepReadonly } from '../utils'

export function performValidation(data: unknown, rules: DeepReadonly<DataRule[]>, error: ValidationError) {
  if (!rules.every((rule) => doesSatisfyRule(data, rule))) {
    const message = renderMessage(data, error)
    const code = getErrorCode(error)
    throw new UserFacingError(message, code, error.context)
  }
}

export function doesSatisfyRule(data: unknown, rule: DataRule): boolean {
  switch (rule.type) {
    case 'rowCountEq':
      if (Array.isArray(data)) {
        return data.length === rule.args
      }
      if (data === null) {
        return rule.args === 0
      }
      return rule.args === 1

    case 'rowCountNeq':
      if (Array.isArray(data)) {
        return data.length !== rule.args
      }
      if (data === null) {
        return rule.args !== 0
      }
      return rule.args !== 1

    case 'affectedRowCountEq':
      return data === rule.args

    case 'never':
      return false

    default:
      assertNever(rule, `Unknown rule type: ${(rule as DataRule).type}`)
  }
}

function renderMessage(data: unknown, error: ValidationError): string {
  switch (error.errorIdentifier) {
    case 'RELATION_VIOLATION':
      return `The change you are trying to make would violate the required relation '${error.context.relation}' between the \`${error.context.modelA}\` and \`${error.context.modelB}\` models.`
    case 'MISSING_RECORD':
      return `An operation failed because it depends on one or more records that were required but not found. No record was found for ${error.context.operation}.`
    case 'MISSING_RELATED_RECORD': {
      const hint = error.context.neededFor ? ` (needed to ${error.context.neededFor})` : ''
      return `An operation failed because it depends on one or more records that were required but not found. No '${error.context.model}' record${hint} was found for ${error.context.operation} on ${error.context.relationType} relation '${error.context.relation}'.`
    }
    case 'INCOMPLETE_CONNECT_INPUT':
      return `An operation failed because it depends on one or more records that were required but not found. Expected ${
        error.context.expectedRows
      } records to be connected, found only ${Array.isArray(data) ? data.length : data}.`
    case 'INCOMPLETE_CONNECT_OUTPUT':
      return `The required connected records were not found. Expected ${
        error.context.expectedRows
      } records to be connected after connect operation on ${error.context.relationType} relation '${
        error.context.relation
      }', found ${Array.isArray(data) ? data.length : data}.`
    case 'RECORDS_NOT_CONNECTED':
      return `The records for relation \`${error.context.relation}\` between the \`${error.context.parent}\` and \`${error.context.child}\` models are not connected.`

    default:
      assertNever(error, `Unknown error identifier: ${error}`)
  }
}

function getErrorCode(error: ValidationError): string {
  switch (error.errorIdentifier) {
    case 'RELATION_VIOLATION':
      return 'P2014'
    case 'RECORDS_NOT_CONNECTED':
      return 'P2017'
    case 'INCOMPLETE_CONNECT_OUTPUT':
      return 'P2018'
    case 'MISSING_RECORD':
    case 'MISSING_RELATED_RECORD':
    case 'INCOMPLETE_CONNECT_INPUT':
      return 'P2025'

    default:
      assertNever(error, `Unknown error identifier: ${error}`)
  }
}
