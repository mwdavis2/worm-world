import { type Allele } from 'models/frontend/Allele/Allele';

/** The pieces of an allele a display mode can show. */
export type AlleleField = 'gene' | 'name' | 'contents' | 'sign';

export interface AlleleDisplayMode {
  id: string;
  label: string;
  // Which pieces are shown. `gene` wraps the rest as gene(...) when the
  // allele has a gene; `name` and `sign` (- for a mutant allele, + for the
  // wild-type copy, only alongside a gene) are alternatives for the core;
  // `contents` is appended exactly as stored (any brackets come from the
  // contents text itself).
  fields: AlleleField[];
}

/**
 * The modes the allele-label toggle cycles through, in order. A mode is just
 * the list of fields it shows, so adding one is a new entry here.
 */
export const ALLELE_DISPLAY_MODES: AlleleDisplayMode[] = [
  { id: 'name', label: 'Name', fields: ['name'] },
  { id: 'gene-name', label: 'Gene(name)', fields: ['gene', 'name'] },
  {
    id: 'name-contents',
    label: 'Name + contents',
    fields: ['name', 'contents'],
  },
  {
    id: 'gene-name-contents',
    label: 'Gene(name + contents)',
    fields: ['gene', 'name', 'contents'],
  },
  { id: 'gene-sign', label: 'Gene(-/+)', fields: ['gene', 'sign'] },
];

/** What the labels looked like before display modes existed. */
export const DEFAULT_ALLELE_DISPLAY_MODE = 'gene-name';

/** Longer contents text is cut to this many characters (ending in an ellipsis). */
export const MAX_CONTENTS_LENGTH = 40;

const modeFor = (modeId: string): AlleleDisplayMode =>
  ALLELE_DISPLAY_MODES.find((mode) => mode.id === modeId) ??
  ALLELE_DISPLAY_MODES.find(
    (mode) => mode.id === DEFAULT_ALLELE_DISPLAY_MODE
  ) ??
  ALLELE_DISPLAY_MODES[0];

export const getAlleleDisplayMode = (modeId: string): AlleleDisplayMode =>
  modeFor(modeId);

/** The mode after `modeId` in the cycle (wrapping around). */
export const nextAlleleDisplayMode = (modeId: string): string => {
  const index = ALLELE_DISPLAY_MODES.findIndex((mode) => mode.id === modeId);
  return ALLELE_DISPLAY_MODES[(index + 1) % ALLELE_DISPLAY_MODES.length].id;
};

/**
 * The text to show for an allele in the given display mode. `truncate`
 * (default on) cuts long contents; pass false for the full text, e.g. a
 * tooltip. `partner` is the allele it is paired with, which decides how the
 * wild copy of a rearrangement is shown (see below).
 */
export const formatAlleleLabel = (
  allele: Allele,
  modeId: string,
  truncate = true,
  partner?: Allele
): string => {
  // The wild copy of a rearrangement (an inversion balancer such as tmC1, or a
  // translocation half): in a heterozygote it reads "tmC1(+)" in every display
  // mode; in a homozygote (both copies wild) it is left blank, since the card
  // marks the region itself. Without a partner it is blank.
  if (allele.isWild() && allele.hasRearrangementRange())
    return partner !== undefined && !partner.isWild()
      ? allele.getQualifiedName()
      : '';

  const { fields } = modeFor(modeId);
  const { prefix, name } = allele.getLabelParts();
  const withGene = fields.includes('gene') && prefix !== undefined;

  let core = fields.includes('sign') && withGene ? signOf(allele) : name;
  const contents = allele.contents?.trim() ?? '';
  if (fields.includes('contents') && contents !== '') {
    const shown =
      truncate && contents.length > MAX_CONTENTS_LENGTH
        ? `${contents.slice(0, MAX_CONTENTS_LENGTH - 1)}…`
        : contents;
    core = `${core} ${shown}`;
  }
  return withGene ? `${prefix}(${core})` : core;
};

const signOf = (allele: Allele): string => (allele.isWild() ? '+' : '-');
