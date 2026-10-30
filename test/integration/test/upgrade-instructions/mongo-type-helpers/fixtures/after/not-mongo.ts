import { z } from 'zod';

export const schema = z.object({ name: z.string() });
export const field = { string: () => 'text' };
export const name = field.string();
