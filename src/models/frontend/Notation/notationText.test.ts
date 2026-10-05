import { describe, expect, test } from 'vitest';
import {
  collectAlleleNames,
  escapeName,
  looksLikeNotation,
  NotationParseError,
  parseNotation,
  serializeNotation,
  type NotationNode,
} from './notationText';

const locus = (top: string, bot: string): { top: string; bot: string } => ({
  top,
  bot,
});

// The worked example from the design: a cross of a founder herm and a founder
// male, one child self-crossed.
const EXAMPLE =
  '{{{dpy-5/+}{unc-119/0}{unc-119/+ dpy-5/dpy-5}}{}{unc-119/unc-119 dpy-5/dpy-5}}';
const EXAMPLE_TREE: NotationNode = {
  kind: 'cross',
  herm: {
    kind: 'cross',
    herm: { kind: 'founder', loci: [locus('dpy-5', '+')] },
    male: { kind: 'founder', loci: [locus('unc-119', '0')] },
    loci: [locus('unc-119', '+'), locus('dpy-5', 'dpy-5')],
  },
  male: undefined,
  loci: [locus('unc-119', 'unc-119'), locus('dpy-5', 'dpy-5')],
};

describe('serializeNotation / parseNotation', () => {
  test('the worked example parses to the expected tree and writes back identically', () => {
    expect(parseNotation(EXAMPLE)).toEqual(EXAMPLE_TREE);
    expect(serializeNotation(EXAMPLE_TREE)).toBe(EXAMPLE);
  });

  test('a founder is a flat list', () => {
    const founder: NotationNode = {
      kind: 'founder',
      loci: [locus('e873', '+'), locus('+', '+')],
    };
    expect(serializeNotation(founder)).toBe('{e873/+ +/+}');
    expect(parseNotation('{e873/+ +/+}')).toEqual(founder);
  });

  test('a self-cross has an empty second slot and a cross has a male node', () => {
    const parent: NotationNode = { kind: 'founder', loci: [locus('a', 'a')] };
    const self = parseNotation('{{a/a}{}{a/a}}');
    expect(self).toEqual({
      kind: 'cross',
      herm: parent,
      male: undefined,
      loci: [locus('a', 'a')],
    });
    const cross = parseNotation('{{a/a}{b/0}{a/+}}');
    expect(cross.kind === 'cross' && cross.male?.kind).toBe('founder');
  });

  test('names with parentheses and brackets are ordinary characters', () => {
    const text = '{eT1(III)/+ nT1[qIs51](IV)/eT1(III)}';
    const node = parseNotation(text);
    expect(node).toEqual({
      kind: 'founder',
      loci: [locus('eT1(III)', '+'), locus('nT1[qIs51](IV)', 'eT1(III)')],
    });
    expect(serializeNotation(node)).toBe(text);
  });

  test('every name round-trips, including ones with delimiters, spaces and backslashes', () => {
    const awkward = ['a{b', 'c}d', 'e/f', 'g h', 'i\\j', 'k\nl', 'plain'];
    const node: NotationNode = {
      kind: 'cross',
      herm: {
        kind: 'founder',
        loci: awkward.map((name) => locus(name, '+')),
      },
      male: { kind: 'founder', loci: [locus('x y', '0')] },
      loci: awkward.map((name) => locus('+', name)),
    };
    expect(parseNotation(serializeNotation(node))).toEqual(node);
  });

  test('escapeName escapes only what needs it', () => {
    expect(escapeName('eT1(III)')).toBe('eT1(III)');
    expect(escapeName('a{b}')).toBe('a\\{b\\}');
    expect(escapeName('a/b c')).toBe('a\\/b\\ c');
  });

  test('whitespace and line breaks between groups and loci are allowed', () => {
    const spaced = '  {\n {a/+}\n {b/0}\n {a/+   b/+}\n}\n';
    expect(parseNotation(spaced)).toEqual({
      kind: 'cross',
      herm: { kind: 'founder', loci: [locus('a', '+')] },
      male: { kind: 'founder', loci: [locus('b', '0')] },
      loci: [locus('a', '+'), locus('b', '+')],
    });
  });
});

describe('parse errors', () => {
  test.each([
    ['', 'empty text'],
    ['a/+', 'no braces'],
    ['{a/+', 'unclosed'],
    ['{a/+}}', 'extra closing brace'],
    ['{a/+} {b/+}', 'text after the notation'],
    ['{a+}', 'a locus without a slash'],
    ['{a/b/c}', 'a locus with two slashes'],
    ['{/+}', 'an empty allele name'],
    ['{a/}', 'an empty allele name'],
    ['{}', 'a founder with no loci'],
    ['{{a/+}{}{}}', 'an own-locus group with no loci'],
    ['{{}{a/+}{a/+}}', 'a parent with no loci'],
    ['{a/+ {b/+}}', 'a group inside a locus list'],
    ['{a\\', 'a backslash at the end'],
  ])('%j is rejected (%s)', (text) => {
    expect(() => parseNotation(text)).toThrow(NotationParseError);
  });

  test('the error says where it went wrong', () => {
    expect(() => parseNotation('{a/+ b}')).toThrow(/character 7/);
  });
});

describe('looksLikeNotation', () => {
  test('accepts notation, with surrounding whitespace', () => {
    expect(looksLikeNotation(EXAMPLE)).toBe(true);
    expect(looksLikeNotation(`\n  ${EXAMPLE}  \n`)).toBe(true);
  });

  test.each([
    'hello world',
    '',
    '{}',
    '{not a locus}',
    'unc-36(e873) eT1(III)/+ + III; eT1(V)/+ V.',
    '{{a/+}',
  ])('rejects %j', (text) => {
    expect(looksLikeNotation(text)).toBe(false);
  });
});

describe('collectAlleleNames', () => {
  test('lists every allele once, without the placeholders', () => {
    expect([...collectAlleleNames(EXAMPLE_TREE)].sort()).toEqual([
      'dpy-5',
      'unc-119',
    ]);
    expect(collectAlleleNames(parseNotation('{+/+ +/0}')).size).toBe(0);
  });
});
