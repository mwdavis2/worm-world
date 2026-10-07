#!/usr/bin/env node
// Zips the seed CSVs (src-tauri/seed, or the folder given) into data/seed.zip,
// the full first-run data as one file for "Import Data Tables Zip File":
//
//   node scripts/zip-seed.mjs [seed folder]
//
// scripts/export-seed.mjs and export-seed.sh run this after writing the CSVs.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipFolder } from './lib/zipFolder.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
zipFolder(process.argv[2] ?? join(root, 'src-tauri', 'seed'), join(root, 'data', 'seed.zip'));
