#!/usr/bin/env node
// Sets the app version everywhere it is written, so a build's version matches
// its release tag (v0.6.0-alpha -> 0.6.0):
//
//   node scripts/set-version.mjs 0.6.0
//
// The macOS Info.plist version comes from src-tauri/tauri.conf.json and must be
// a plain dotted number (no "-alpha"), so the pre-release label stays in the
// tag and release name only. Run it before each release build.
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('usage: node scripts/set-version.mjs <major.minor.patch>, e.g. 0.6.0');
  process.exit(1);
}

const edit = (file, change) => {
  const before = readFileSync(file, 'utf8');
  const after = change(before);
  if (after === before) console.log(`${file}: already ${version}`);
  else {
    writeFileSync(file, after);
    console.log(`${file}: set to ${version}`);
  }
};
const mustReplace = (text, pattern, replacement, file) => {
  if (!pattern.test(text)) {
    console.error(`${file}: version line not found`);
    process.exit(1);
  }
  return text.replace(pattern, replacement);
};

// src-tauri/tauri.conf.json: package.version
edit('src-tauri/tauri.conf.json', (text) =>
  mustReplace(text, /("productName": "WormWorld",\s*"version": ")[^"]+(")/, `$1${version}$2`, 'tauri.conf.json')
);
// package.json and the root entries of package-lock.json
edit('package.json', (text) => mustReplace(text, /^(\s*"version": ")[^"]+(",)/m, `$1${version}$2`, 'package.json'));
edit('package-lock.json', (text) => {
  const lock = JSON.parse(text);
  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;
  return `${JSON.stringify(lock, null, 2)}\n`;
});
// src-tauri/Cargo.toml and its lockfile entry for this package
edit('src-tauri/Cargo.toml', (text) => mustReplace(text, /(\[package\]\nname = "worm-world"\nversion = ")[^"]+(")/, `$1${version}$2`, 'Cargo.toml'));
edit('src-tauri/Cargo.lock', (text) => mustReplace(text, /(name = "worm-world"\nversion = ")[^"]+(")/, `$1${version}$2`, 'Cargo.lock'));
