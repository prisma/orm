import { PrismaClientKnownRequestError, PrismaClientUnknownRequestError } from '@prisma/client-runtime-utils'

import { RequestError } from '../../engines/common/types/RequestError'

const TOO_MANY_CONNECTIONS_ERROR = 'P2037'

// TODO: delete after removing `LibraryEngine`
export function prismaGraphQLToJSError(
  { error, user_facing_error }: RequestError,
  clientVersion: string,
  activeProvider: string,
): PrismaClientKnownRequestError | PrismaClientUnknownRequestError {
  if (user_facing_error.error_code) {
    return new PrismaClientKnownRequestError(getKnownErrorMessage(user_facing_error, activeProvider), {
      code: user_facing_error.error_code,
      clientVersion,
      meta: user_facing_error.meta,
      batchRequestIdx: user_facing_error.batch_request_idx,
    })
  }

  return new PrismaClientUnknownRequestError(error, {
    clientVersion,
    batchRequestIdx: user_facing_error.batch_request_idx,
  })
}

function getKnownErrorMessage(userFacingError: RequestError['user_facing_error'], activeProvider: string) {
  let message = userFacingError.message
  if (
    (activeProvider === 'postgresql' || activeProvider === 'postgres' || activeProvider === 'mysql') &&
    userFacingError.error_code === TOO_MANY_CONNECTIONS_ERROR
  ) {
    message +=
      '\nPrisma Accelerate has built-in connection pooling to prevent such errors: https://pris.ly/client/error-accelerate'
  }

  return message
}
