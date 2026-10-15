function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface IntervalLoop {
  /** Para de agendar novas execuções e resolve quando a execução atual terminar. */
  stop(): Promise<void>;
}

export interface IntervalLoopOptions {
  intervalMs: number;
  run: () => Promise<void>;
  onError: (error: unknown) => void;
}

/**
 * Pequeno agendador cooperativo para workers em background. Executa `task` a
 * cada `intervalMs`, nunca sobrepondo duas execuções, e para de forma limpa
 * dentro de um intervalo para que o shutdown não trave.
 */
export function startIntervalLoop(options: IntervalLoopOptions): IntervalLoop {
  let running = true;
  let pending: Promise<void> = Promise.resolve();

  const schedule = (): void => {
    pending = delay(options.intervalMs).then(async () => {
      if (!running) {
        return;
      }
      try {
        await options.run();
      } catch (error) {
        options.onError(error);
      }
      schedule();
    });
  };

  schedule();

  return {
    async stop(): Promise<void> {
      running = false;
      await pending;
    },
  };
}
