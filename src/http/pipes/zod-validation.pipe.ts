import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { RequestValidationError } from '../errors/request-validation.error';

/**
 * Binds a zod schema to a route parameter. On failure it throws a
 * `RequestValidationError`, which the exception filter renders as a `400` with
 * a per-field breakdown — so a provider can fix the payload without guessing.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new RequestValidationError(
        'Request validation failed',
        result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}
