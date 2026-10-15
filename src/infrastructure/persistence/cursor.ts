import { DomainError } from '../../domain/shared/errors';

export interface LedgerCursor {
  createdAt: Date;
  id: string;
}

export class InvalidCursorError extends DomainError {
  readonly code = 'INVALID_CURSOR';
  constructor() {
    super('The provided cursor is not valid');
  }
}

const SEPARATOR = '|';

/**
 * Os cursors de ledger são tokens opacos e seguros para URL sobre `(createdAt, id)`. A ordenação
 * por `(created_at, id)` torna a posição estável mesmo quando muitas entradas compartilham
 * o mesmo timestamp.
 */
export function encodeLedgerCursor(cursor: LedgerCursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}${SEPARATOR}${cursor.id}`, 'utf8').toString(
    'base64url',
  );
}

export function decodeLedgerCursor(raw: string): LedgerCursor {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw new InvalidCursorError();
  }

  const separatorIndex = decoded.indexOf(SEPARATOR);
  if (separatorIndex <= 0) {
    throw new InvalidCursorError();
  }

  const createdAt = new Date(decoded.slice(0, separatorIndex));
  const id = decoded.slice(separatorIndex + 1);

  if (Number.isNaN(createdAt.getTime()) || id.length === 0) {
    throw new InvalidCursorError();
  }

  return { createdAt, id };
}
