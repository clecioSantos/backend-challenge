/** Descrição mínima e agnóstica de transporte de um evento de integração a publicar. */
export interface PublishableMessage {
  /** Id de evento estável; também usado como id de deduplicação do broker. */
  id: string;
  eventType: string;
  /** Usado como group id da mensagem FIFO para preservar a ordenação por aggregate. */
  aggregateId: string;
  payload: Record<string, unknown>;
}

export interface MessagePublisher {
  publish(message: PublishableMessage): Promise<void>;
}
