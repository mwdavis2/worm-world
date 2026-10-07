// The generators (scripts/build-*.mjs) each write data/<set>.zip next to their
// folder, so the set can be loaded with "Import Data Tables Zip File". This reads
// each zip back with an independent minimal reader and checks it holds exactly
// the folder's CSV files, byte for byte.
import { existsSync, readdirSync, readFileSync } from 'fs';
import { inflateRawSync } from 'zlib';
import { describe, expect, test } from 'vitest';

const SETS = [
  'translocations',
  'balancer_alleles',
  'balancer_strains',
  'inversion_balancers',
  'lin_15',
  'mIn1',
];

const readZip = (path: string): Map<string, Buffer> => {
  const zip = readFileSync(path);
  // end of central directory record: the last 0x06054b50 signature
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end, `${path}: no end-of-directory record`).toBeGreaterThanOrEqual(0);
  const entries = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < entries; i++) {
    expect(zip.readUInt32LE(offset)).toBe(0x02014b50);
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    expect(zip.readUInt32LE(localOffset)).toBe(0x04034b50);
    const dataStart =
      localOffset +
      30 +
      zip.readUInt16LE(localOffset + 26) +
      zip.readUInt16LE(localOffset + 28);
    const raw = zip.subarray(dataStart, dataStart + compressedSize);
    expect(method).toBe(8);
    files.set(name, inflateRawSync(raw));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
};

describe('data set zips', () => {
  test.each(SETS)('data/%s.zip matches the data/%s folder', (set) => {
    expect(existsSync(`data/${set}.zip`), `data/${set}.zip is missing`).toBe(
      true
    );
    const files = readZip(`data/${set}.zip`);
    const csvs = readdirSync(`data/${set}`)
      .filter((name) => name.endsWith('.csv'))
      .sort();
    expect([...files.keys()].sort()).toEqual(csvs);
    csvs.forEach((name) => {
      expect(
        files.get(name)?.equals(readFileSync(`data/${set}/${name}`)),
        `${set}/${name} differs from the zip`
      ).toBe(true);
    });
  });
});
