/**
 * Line-breaking for allele labels in the SVG export, approximating the
 * browser's wrapping of the same text on a strain card: breaks are allowed at
 * spaces and just after a hyphen ("Punc-" / "122::GAP-"), and a single
 * unbreakable piece is never split, even if it is wider than the limit.
 */

interface Piece {
  text: string;
  // Whether a space separated this piece from the one before it.
  spaceBefore: boolean;
}

const toPieces = (text: string): Piece[] => {
  const pieces: Piece[] = [];
  text
    .split(' ')
    .filter((word) => word !== '')
    .forEach((word) => {
      let current = '';
      let first = true;
      const flush = (): void => {
        if (current === '') return;
        pieces.push({ text: current, spaceBefore: first });
        first = false;
        current = '';
      };
      for (let i = 0; i < word.length; i++) {
        current += word[i];
        // Break after a hyphen, but only if something follows it.
        if (word[i] === '-' && i < word.length - 1) flush();
      }
      flush();
    });
  return pieces;
};

/** Width of the widest piece that can't be broken further. */
export const minContentWidth = (
  text: string,
  measure: (s: string) => number
): number =>
  toPieces(text).reduce((widest, p) => Math.max(widest, measure(p.text)), 0);

/** Greedily fills lines up to `maxWidth` (a single wider piece gets its own line). */
export const wrapLabel = (
  text: string,
  maxWidth: number,
  measure: (s: string) => number
): string[] => {
  const lines: string[] = [];
  let line = '';
  toPieces(text).forEach((piece) => {
    const candidate =
      line === ''
        ? piece.text
        : line + (piece.spaceBefore ? ' ' : '') + piece.text;
    if (line === '' || measure(candidate) <= maxWidth) {
      line = candidate;
    } else {
      lines.push(line);
      line = piece.text;
    }
  });
  if (line !== '') lines.push(line);
  return lines.length === 0 ? [text] : lines;
};
