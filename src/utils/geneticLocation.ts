import { getFilteredGenes } from 'api/gene';
import { type ChromosomeName } from 'models/db/filter/db_ChromosomeName';
import { type GeneFieldName } from 'models/db/filter/db_GeneFieldName';
import { type FilterGroup } from 'models/db/filter/FilterGroup';

// Used when a new Variation is created with only a physical position (no
// independently-supplied genetic position) - genotype ordering
// (Allele.getGenPosition()) only ever consults geneticLoc, never physLoc, so
// one needs to be derived. There is no existing conversion anywhere in the
// codebase (confirmed directly against the code before writing this) - the
// Genes table is the ground truth, since every Gene row that has both
// physLoc and geneticLoc set is a known anchor point on its chromosome.

interface AnchorPoint {
  physLoc: number;
  geneticLoc: number;
}

// Built lazily, once per app session - not persisted to disk, since the
// Genes table can change between sessions and recomputing once per session
// is cheap.
let anchorsByChromosome: Map<ChromosomeName, AnchorPoint[]> | undefined;

const buildAnchorCache = async (): Promise<
  Map<ChromosomeName, AnchorPoint[]>
> => {
  const filter: FilterGroup<GeneFieldName> = {
    filters: [[['PhysLoc', 'NotNull']], [['GeneticLoc', 'NotNull']]],
    orderBy: [],
  };
  const genes = await getFilteredGenes(filter);

  const map = new Map<ChromosomeName, AnchorPoint[]>();
  genes.forEach((gene) => {
    if (
      gene.chromosome === null ||
      gene.physLoc === null ||
      gene.geneticLoc === null
    ) {
      return;
    }
    const anchors = map.get(gene.chromosome) ?? [];
    anchors.push({ physLoc: gene.physLoc, geneticLoc: gene.geneticLoc });
    map.set(gene.chromosome, anchors);
  });
  map.forEach((anchors) => anchors.sort((a, b) => a.physLoc - b.physLoc));
  return map;
};

// Exposed only for tests, to reset the lazily-built cache between them.
export const resetGeneticLocationCache = (): void => {
  anchorsByChromosome = undefined;
};

const FALLBACK_GENETIC_LOC = 50;

// Linearly interpolates (or extrapolates, if physLoc falls outside the known
// range for this chromosome) a genetic location from the Genes table's own
// physLoc/geneticLoc anchor points. Falls back to 50 (matching the existing
// `?? 50` convention already used for a fully-unknown genetic position, e.g.
// AllelePair.ts:55-56) when fewer than 2 anchors exist for the chromosome.
export const interpolateGeneticLoc = async (
  chromosome: ChromosomeName,
  physLoc: number
): Promise<number> => {
  if (anchorsByChromosome === undefined) {
    anchorsByChromosome = await buildAnchorCache();
  }
  const anchors = anchorsByChromosome.get(chromosome);
  if (anchors === undefined || anchors.length < 2) {
    return FALLBACK_GENETIC_LOC;
  }

  // Find the nearest flanking pair - the last anchor at or before physLoc,
  // and the first anchor after it. If physLoc is outside the full range,
  // this naturally lands on the two anchors at the appropriate end,
  // extrapolating along the same line rather than falling back.
  let lowerIdx = -1;
  for (let i = 0; i < anchors.length; i++) {
    if (anchors[i].physLoc <= physLoc) lowerIdx = i;
    else break;
  }
  const [a1, a2] =
    lowerIdx <= 0
      ? [anchors[0], anchors[1]]
      : lowerIdx >= anchors.length - 1
      ? [anchors[anchors.length - 2], anchors[anchors.length - 1]]
      : [anchors[lowerIdx], anchors[lowerIdx + 1]];

  return (
    a1.geneticLoc +
    ((physLoc - a1.physLoc) * (a2.geneticLoc - a1.geneticLoc)) /
      (a2.physLoc - a1.physLoc)
  );
};
