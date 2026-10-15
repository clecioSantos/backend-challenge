import type { OutboxMessage } from './outbox-message';

export interface OutboxRepository {
  insert(message: OutboxMessage): Promise<void>;

  /**
   * Bloqueia até `limit` linhas vencidas e não publicadas com
   * `FOR UPDATE SKIP LOCKED`, da mais antiga para a mais recente. O lock é
   * mantido até o fim da transação adjacente, então publishers concorrentes
   * nunca pegam a mesma linha.
   */
  lockDueForUpdate(now: Date, limit: number): Promise<OutboxMessage[]>;

  save(message: OutboxMessage): Promise<void>;

  countPending(): Promise<number>;

  /** Idade em milissegundos da linha não publicada mais antiga, ou `null` quando drenado. */
  oldestPendingAgeMs(now: Date): Promise<number | null>;
}
