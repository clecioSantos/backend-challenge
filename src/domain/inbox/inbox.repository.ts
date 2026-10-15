import type { InboxMessage } from './inbox-message';

export interface InboxRepository {
  find(consumerName: string, messageId: string): Promise<InboxMessage | null>;

  /**
   * Insere o registro de deduplicação de forma atômica e retorna `true` quando
   * este chamador venceu a corrida. Retorna `false` quando `(consumerName,
   * messageId)` já existe, o que significa que a mensagem foi (ou está sendo)
   * tratada em outro lugar.
   */
  insertIfAbsent(message: InboxMessage): Promise<boolean>;

  markProcessed(consumerName: string, messageId: string, processedAt: Date): Promise<void>;
}
