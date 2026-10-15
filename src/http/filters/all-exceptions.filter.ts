import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError, InfrastructureError } from '../../domain/shared/errors';
import { RequestValidationError } from '../errors/request-validation.error';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    correlationId?: string;
    issues?: readonly { path: string; message: string }[];
  };
}

/**
 * Mapeia falhas de domínio e de infraestrutura para códigos de status HTTP.
 *
 * O mapeamento é intencional: um provider precisa conseguir distinguir um payload
 * corrigível de uma rejeição de negócio terminal, de um conflito de idempotência e de
 * uma indisponibilidade transitória — sem parsear a mensagem.
 */
const DOMAIN_STATUS: Record<string, HttpStatus> = {
  INVALID_MONEY: HttpStatus.BAD_REQUEST,
  VALIDATION_ERROR: HttpStatus.BAD_REQUEST,
  INVALID_CURSOR: HttpStatus.BAD_REQUEST,
  CURRENCY_MISMATCH: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_LEDGER_ENTRY: HttpStatus.UNPROCESSABLE_ENTITY,
  INSUFFICIENT_FUNDS: HttpStatus.UNPROCESSABLE_ENTITY,
  UNSUPPORTED_TRANSACTION_KIND: HttpStatus.UNPROCESSABLE_ENTITY,
  REFERENCE_REQUIRED: HttpStatus.UNPROCESSABLE_ENTITY,
  UNEXPECTED_REFERENCE: HttpStatus.UNPROCESSABLE_ENTITY,
  REFERENCE_NOT_FOUND: HttpStatus.UNPROCESSABLE_ENTITY,
  REFERENCE_NOT_PROCESSED: HttpStatus.UNPROCESSABLE_ENTITY,
  REFERENCE_KIND_NOT_ALLOWED: HttpStatus.UNPROCESSABLE_ENTITY,
  REFERENCE_MISMATCH: HttpStatus.UNPROCESSABLE_ENTITY,
  REFERENCE_AMOUNT_MISMATCH: HttpStatus.UNPROCESSABLE_ENTITY,
  REFERENCE_ALREADY_REVERSED: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_TRANSACTION_STATE: HttpStatus.CONFLICT,
  IDEMPOTENCY_CONFLICT: HttpStatus.CONFLICT,
  WALLET_ALREADY_EXISTS: HttpStatus.CONFLICT,
  UNIQUE_CONSTRAINT_VIOLATION: HttpStatus.CONFLICT,
  WALLET_NOT_FOUND: HttpStatus.NOT_FOUND,
  WAGER_TRANSACTION_NOT_FOUND: HttpStatus.NOT_FOUND,
  OPTIMISTIC_LOCK_CONFLICT: HttpStatus.SERVICE_UNAVAILABLE,
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request & { id?: string }>();
    const response = context.getResponse<Response>();
    const correlationId = request.id;

    const { status, body } = this.resolve(exception, correlationId);
    response.status(status).json(body);
  }

  private resolve(exception: unknown, correlationId?: string): { status: number; body: ErrorBody } {
    if (exception instanceof RequestValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          error: {
            code: exception.code,
            message: exception.message,
            issues: exception.issues,
            ...(correlationId ? { correlationId } : {}),
          },
        },
      };
    }

    if (exception instanceof DomainError) {
      const status = DOMAIN_STATUS[exception.code] ?? HttpStatus.UNPROCESSABLE_ENTITY;
      return {
        status,
        body: {
          error: {
            code: exception.code,
            message: exception.message,
            ...(correlationId ? { correlationId } : {}),
          },
        },
      };
    }

    if (exception instanceof InfrastructureError) {
      return {
        status: exception.retryable ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.INTERNAL_SERVER_ERROR,
        body: {
          error: {
            code: 'INFRASTRUCTURE_ERROR',
            message: exception.message,
            ...(correlationId ? { correlationId } : {}),
          },
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        body: {
          error: {
            code: `HTTP_${status}`,
            message: exception.message,
            ...(correlationId ? { correlationId } : {}),
          },
        },
      };
    }

    this.logger.error({ err: exception }, 'Unhandled exception');
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
          ...(correlationId ? { correlationId } : {}),
        },
      },
    };
  }
}
