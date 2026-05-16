import { logger } from './logger.js';

type Task<T> = {
  fn: () => Promise<T>;
  label: string;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
};

/**
 * A tiny FIFO queue that serializes async tasks against a single resource.
 * We use one of these in front of the Playwright browser so concurrent Telegram
 * callbacks never collide on the page.
 */
export class ActionQueue {
  private readonly tasks: Array<Task<unknown>> = [];
  private running = false;

  enqueue<T>(label: string, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.tasks.push({
        fn: fn as () => Promise<unknown>,
        label,
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      void this.drain();
    });
  }

  get depth(): number {
    return this.tasks.length + (this.running ? 1 : 0);
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    while (this.tasks.length > 0) {
      const task = this.tasks.shift()!;
      const start = Date.now();
      try {
        logger.debug({ label: task.label, depth: this.tasks.length }, 'queue.task.start');
        const result = await task.fn();
        logger.debug(
          { label: task.label, ms: Date.now() - start },
          'queue.task.done',
        );
        task.resolve(result);
      } catch (err) {
        logger.error(
          { label: task.label, ms: Date.now() - start, err },
          'queue.task.failed',
        );
        task.reject(err);
      }
    }
    this.running = false;
  }
}

export const browserQueue = new ActionQueue();
