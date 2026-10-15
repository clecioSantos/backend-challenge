import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { RequestValidationError } from '../errors/request-validation.error';

/**
 * Vincula um schema zod a um parâmetro de rota. Em caso de falha, lança um
 * `RequestValidationError`, que o filter de exceções renderiza como um `400` com
 * uma discriminação por campo — para que um provider possa corrigir o payload sem adivinhar.
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
