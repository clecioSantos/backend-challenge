export interface IntervalLoop {
  /** Para de agendar novas execuções e resolve assim que a execução em andamento terminar. */
  stop(): Promise<void>;
}

export interface IntervalLoopOptions {
  intervalMs: number;
  run: () => Promise<void>;
  onError: (error: unknown) => void;
}

/**
 * Pequeno agendador cooperativo para workers em background. Executa `run` a cada
 * `intervalMs`, nunca sobrepõe duas execuções e para de forma limpa.
 *
 * `stop()` cancela o timer pendente e aguarda apenas a execução em andamento —
 * não o intervalo restante —, para que o shutdown não dependa do tamanho do
 * intervalo configurado.
 */
export function startIntervalLoop(options: IntervalLoopOptions): IntervalLoop {
  let running = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  const schedule = (): void => {
    if (!running) {
      return;
    }

    timer = setTimeout(() => {
      if (!running) {
        return;
      }

      inFlight = (async () => {
        try {
          await options.run();
        } catch (error) {
          options.onError(error);
        }
      })();

      void inFlight.then(() => schedule());
    }, options.intervalMs);
  };

  schedule();

  return {
    async stop(): Promise<void> {
      running = false;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      await inFlight;
    },
  };
}
