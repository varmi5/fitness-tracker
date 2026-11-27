// Bound simultaneous provider reads and database batches on small deployments.
const limit = 2;
let running = 0;
const waiters: (() => void)[] = [];

export async function withWearableSyncSlot<T>(run: () => Promise<T>): Promise<T> {
  if (running === limit) await new Promise<void>((resolve) => waiters.push(resolve));
  else running++;
  try {
    return await run();
  } finally {
    const next = waiters.shift();
    if (next) next();
    else running--;
  }
}
