/**
 * Limits how often a key image or dial feedback is sent to Stream Deck.
 *
 * Elgato's guidelines allow at most 10 programmatic updates per second per
 * key/dial. Heartbeats of many monitors can arrive in bursts, so updates are
 * coalesced: an update within the interval is delayed and replaced by newer
 * ones, and updates that would not change what is shown are skipped.
 */
export const MIN_INTERVAL_MS = 100;

type Apply = (value: string) => Promise<void>;

type Entry = {
  applied?: string;
  lastAt: number;
  pending?: { value: string; apply: Apply };
  timer?: ReturnType<typeof setTimeout>;
};

export class UpdateThrottle {
  readonly #entries = new Map<string, Entry>();
  readonly #interval: number;
  readonly #now: () => number;

  constructor(interval = MIN_INTERVAL_MS, now: () => number = Date.now) {
    this.#interval = interval;
    this.#now = now;
  }

  /** Shows `value` on `id` via `apply`, at most once per interval. */
  update(id: string, value: string, apply: Apply): void {
    let entry = this.#entries.get(id);
    if (!entry) {
      entry = { lastAt: Number.NEGATIVE_INFINITY };
      this.#entries.set(id, entry);
    }

    if (entry.timer) {
      entry.pending = { value, apply };
      return;
    }
    if (value === entry.applied) {
      return;
    }

    const wait = entry.lastAt + this.#interval - this.#now();
    if (wait <= 0) {
      this.#run(entry, value, apply);
      return;
    }

    const e = entry;
    e.pending = { value, apply };
    e.timer = setTimeout(() => {
      e.timer = undefined;
      const next = e.pending;
      e.pending = undefined;
      if (next && next.value !== e.applied) {
        this.#run(e, next.value, next.apply);
      }
    }, wait);
  }

  /** Drops the state of a key/dial that disappeared; it is redrawn in full when it appears again. */
  forget(id: string): void {
    const entry = this.#entries.get(id);
    if (entry?.timer) {
      clearTimeout(entry.timer);
    }
    this.#entries.delete(id);
  }

  #run(entry: Entry, value: string, apply: Apply): void {
    entry.applied = value;
    entry.lastAt = this.#now();
    apply(value).catch(() => {
      // Allow a retry with the same value after a failed update.
      entry.applied = undefined;
    });
  }
}

/** Shared throttle for all keys and dials of the plugin. */
export const updates = new UpdateThrottle();

/** Key image update; an empty image resets the key to its default image. */
export function showImage(key: { id: string; setImage(image?: string): Promise<void> }, image: string | undefined): void {
  updates.update(key.id, image ?? "", (value) => key.setImage(value || undefined));
}
