/**
 * Like `Promise.all(items.map(fn))`, but runs at most `limit` calls of `fn` at
 * once, so a long list cannot flood a shared resource (such as the database
 * connection pool). Results keep the order of `items`; the first rejection
 * rejects the whole call.
 */
export const mapLimit = async <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    async () => {
      await worker();
    }
  );
  await Promise.all(workers);
  return results;
};
