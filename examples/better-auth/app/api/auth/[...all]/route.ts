import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '../../../../src/lib/auth';

export const { GET, POST } = toNextJsHandler(auth);
