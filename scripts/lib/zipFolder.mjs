// A minimal, dependency-free zip writer for the generated data folders, so every
// generator can also write `data/<set>.zip` (importable with the Data Tables
// page's "Import Data Tables Zip File" button) on any OS and Node version.
//
//   import { zipFolder } from './lib/zipFolder.mjs';
//   zipFolder('data/mIn1');   // writes data/mIn1.zip next to the folder
//
// The archive holds the folder's .csv files flat (no folder inside), deflated,
// with a fixed timestamp and sorted names, so regenerating unchanged data gives
// a byte-identical zip and git shows no churn.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01, the zip epoch
const UTF8_NAMES = 0x0800;
const DEFLATE = 8;
const VERSION = 20;

const u16 = (value) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value);
  return b;
};
const u32 = (value) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value >>> 0);
  return b;
};

/** @param entries Array<{ name: string, data: Buffer }> @returns Buffer */
export const zipEntries = (entries) => {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.concat([
      u32(0x04034b50), u16(VERSION), u16(UTF8_NAMES), u16(DEFLATE), u16(DOS_TIME), u16(DOS_DATE),
      u32(crc), u32(compressed.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes,
    ]);
    central.push(
      Buffer.concat([
        u32(0x02014b50), u16(VERSION), u16(VERSION), u16(UTF8_NAMES), u16(DEFLATE), u16(DOS_TIME), u16(DOS_DATE),
        u32(crc), u32(compressed.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0),
        u16(0), u16(0), u32(0), u32(offset), nameBytes,
      ])
    );
    chunks.push(local, compressed);
    offset += local.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(directory.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...chunks, directory, end]);
};

/**
 * Zips the .csv files of `folder` into `zipPath` (default `<folder>.zip`);
 * returns the file names.
 */
export const zipFolder = (folder, zipPath = `${folder}.zip`) => {
  const names = readdirSync(folder)
    .filter((name) => name.endsWith('.csv'))
    .sort();
  const entries = names.map((name) => ({ name, data: readFileSync(join(folder, name)) }));
  writeFileSync(zipPath, zipEntries(entries));
  console.log(`${zipPath}: ${names.length} files`);
  return names;
};
