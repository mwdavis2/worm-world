// The text notation for a card's ancestry (todo #5): braces group, a locus is
// "top/bottom" allele names, loci are separated by spaces.
//
//   founder     {locus locus ...}
//   cross       {{herm}{male}{own loci}}   - herm and male are nodes themselves
//   self-cross  {{herm}{}{own loci}}       - the empty second slot: no male parent
//
// In a locus `+` is the wild-type allele and `0` (second position, X only) means
// there is no second X: a male. A backslash escapes `\`, `{`, `}`, `/` and
// whitespace inside a name, so any name can be written.
//
// This file is the pure text layer: no strains, no database.

export interface NotationLocus {
  top: string;
  bot: string;
}

export type NotationNode =
  | { kind: 'founder'; loci: NotationLocus[] }
  | {
      kind: 'cross';
      herm: NotationNode;
      // Undefined for a self-cross
      male?: NotationNode;
      loci: NotationLocus[];
    };

export class NotationParseError extends Error {
  constructor(message: string, public readonly index: number) {
    super(`${message} (at character ${index + 1})`);
    this.name = 'NotationParseError';
  }
}

const NEEDS_ESCAPE = /[\\{}/\s]/g;

export const escapeName = (name: string): string =>
  name.replace(NEEDS_ESCAPE, (char) => `\\${char}`);

const serializeLocus = (locus: NotationLocus): string =>
  `${escapeName(locus.top)}/${escapeName(locus.bot)}`;

const serializeLoci = (loci: NotationLocus[]): string =>
  loci.map(serializeLocus).join(' ');

export const serializeNotation = (node: NotationNode): string =>
  node.kind === 'founder'
    ? `{${serializeLoci(node.loci)}}`
    : `{${serializeNotation(node.herm)}${
        node.male === undefined ? '{}' : serializeNotation(node.male)
      }{${serializeLoci(node.loci)}}}`;

class Parser {
  private pos = 0;

  constructor(private readonly text: string) {}

  parseAll(): NotationNode {
    this.skipSpace();
    const node = this.parseNode();
    this.skipSpace();
    if (this.pos < this.text.length)
      throw this.error('Unexpected text after the notation');
    return node;
  }

  private error(message: string): NotationParseError {
    return new NotationParseError(message, this.pos);
  }

  private skipSpace(): void {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos]))
      this.pos++;
  }

  private peek(): string | undefined {
    return this.text[this.pos];
  }

  private expect(char: string): void {
    if (this.peek() !== char)
      throw this.error(
        this.peek() === undefined
          ? `Expected "${char}" but the text ended`
          : `Expected "${char}" but found "${this.peek() ?? ''}"`
      );
    this.pos++;
  }

  // A node: a flat list of loci (a founder) or three groups (a cross).
  private parseNode(): NotationNode {
    this.expect('{');
    this.skipSpace();
    if (this.peek() === '{') {
      const herm = this.parseNode();
      this.skipSpace();
      const male = this.parseMaleSlot();
      this.skipSpace();
      const loci = this.parseLociGroup();
      this.skipSpace();
      this.expect('}');
      return { kind: 'cross', herm, male, loci };
    }
    const loci = this.parseLoci();
    this.expect('}');
    return { kind: 'founder', loci };
  }

  // "{}" is the empty slot of a self-cross; anything else is a node.
  private parseMaleSlot(): NotationNode | undefined {
    const start = this.pos;
    this.expect('{');
    this.skipSpace();
    if (this.peek() === '}') {
      this.pos++;
      return undefined;
    }
    this.pos = start;
    return this.parseNode();
  }

  private parseLociGroup(): NotationLocus[] {
    this.expect('{');
    const loci = this.parseLoci();
    this.expect('}');
    return loci;
  }

  // Loci up to (not including) the closing brace; at least one.
  private parseLoci(): NotationLocus[] {
    const loci: NotationLocus[] = [];
    this.skipSpace();
    while (this.peek() !== '}') {
      if (this.peek() === undefined)
        throw this.error('Expected "}" but the text ended');
      loci.push(this.parseLocus());
      this.skipSpace();
    }
    if (loci.length === 0) throw this.error('A group has no loci');
    return loci;
  }

  private parseLocus(): NotationLocus {
    const parts: string[] = [''];
    for (;;) {
      const char = this.peek();
      if (char === undefined || char === '}' || /\s/.test(char)) break;
      if (char === '{') throw this.error('Unexpected "{" inside a locus');
      this.pos++;
      if (char === '\\') {
        const escaped = this.peek();
        if (escaped === undefined)
          throw this.error('The text ends after a backslash');
        this.pos++;
        parts[parts.length - 1] += escaped;
      } else if (char === '/') parts.push('');
      else parts[parts.length - 1] += char;
    }
    if (parts.length !== 2)
      throw this.error('A locus must be written "top/bottom"');
    if (parts[0] === '' || parts[1] === '')
      throw this.error('A locus has an empty allele name');
    return { top: parts[0], bot: parts[1] };
  }
}

/** Parses notation text; throws NotationParseError if it is not valid. */
export const parseNotation = (text: string): NotationNode =>
  new Parser(text).parseAll();

/**
 * True when the text parses as notation - used to decide whether the clipboard
 * is worth offering to paste. The cheap prefix test keeps a large unrelated
 * clipboard from being parsed.
 */
export const looksLikeNotation = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false;
  try {
    parseNotation(trimmed);
    return true;
  } catch {
    return false;
  }
};

/** Every allele name a notation uses (not the `+` and `0` placeholders). */
export const collectAlleleNames = (node: NotationNode): Set<string> => {
  const names = new Set<string>();
  const visit = (current: NotationNode): void => {
    current.loci.forEach(({ top, bot }) => {
      [top, bot].forEach((name) => {
        if (name !== '+' && name !== '0') names.add(name);
      });
    });
    if (current.kind === 'cross') {
      visit(current.herm);
      if (current.male !== undefined) visit(current.male);
    }
  };
  visit(node);
  return names;
};
