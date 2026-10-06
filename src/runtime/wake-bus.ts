export interface WakeSignal {
  pairId: string;
  source: "opencode" | "chatgpt";
  reason: string;
  observedAt: string;
  seq?: number;
  messageId?: string;
}

export type WakeSubscriber = (signal: WakeSignal) => void;

export class WakeBus {
  private readonly subscribers = new Map<string, Set<WakeSubscriber>>();

  subscribe(pairId: string, callback: WakeSubscriber): () => void {
    let pairSubscribers = this.subscribers.get(pairId);
    if (!pairSubscribers) {
      pairSubscribers = new Set();
      this.subscribers.set(pairId, pairSubscribers);
    }
    pairSubscribers.add(callback);

    return () => {
      const current = this.subscribers.get(pairId);
      current?.delete(callback);
      if (current?.size === 0) {
        this.subscribers.delete(pairId);
      }
    };
  }

  emit(signal: WakeSignal): void {
    const pairSubscribers = this.subscribers.get(signal.pairId);
    if (!pairSubscribers) {
      return;
    }

    for (const callback of [...pairSubscribers]) {
      callback(signal);
    }
  }
}
