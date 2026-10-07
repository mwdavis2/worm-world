import { describe, expect, test } from 'vitest';
import { mapLimit } from 'utils/mapLimit';

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

describe('mapLimit', () => {
  test('returns the results in the order of the items', async () => {
    const result = await mapLimit([30, 5, 15], 2, async (ms, i) => {
      await sleep(ms);
      return `${i}:${ms}`;
    });
    expect(result).toEqual(['0:30', '1:5', '2:15']);
  });

  test('never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    await mapLimit(
      Array.from({ length: 20 }, (_, i) => i),
      3,
      async () => {
        running++;
        peak = Math.max(peak, running);
        await sleep(2);
        running--;
      }
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  test('handles an empty list and a limit larger than the list', async () => {
    expect(await mapLimit([], 4, async () => await Promise.resolve(1))).toEqual(
      []
    );
    expect(
      await mapLimit([1, 2], 50, async (n) => await Promise.resolve(n * 2))
    ).toEqual([2, 4]);
  });

  test('rejects when a call rejects', async () => {
    await expect(
      mapLimit([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return await Promise.resolve(n);
      })
    ).rejects.toThrow('boom');
  });
});
