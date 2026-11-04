import { Sex } from 'models/enums';
import { type Strain } from 'models/frontend/Strain/Strain';

/** The cells of a Punnett square that share a genotype (or a phenotype) */
export interface CellGroup {
  id: number;
  label: string;
  /** how many cells are in the group */
  count: number;
  /** their summed probability, 0 to 1 */
  probability: number;
}

export interface CellGroups {
  genotype: CellGroup;
  phenotype: CellGroup;
}

/**
 * Sorts the cells of a Punnett square into genotype groups (cells that are the
 * same strain, sex included, as a cross merges its children) and phenotype
 * groups (cells that express the same phenotypes, lethal or not). Males and
 * hermaphrodites share a phenotype group unless an allele in the cross is on
 * the X, where the sex is part of the phenotype. Returns, for each cell, its two
 * groups; a pairing that makes no worm has none.
 */
export const groupPunnettCells = (
  cells: Array<Array<Strain | undefined>>
): Array<Array<CellGroups | undefined>> => {
  const strains = cells
    .flat()
    .filter((cell): cell is Strain => cell !== undefined);
  const xLinked = strains.some((strain) =>
    strain.getNonWildAlleles().some((allele) => allele.isX())
  );

  const genotypeReps: Array<{ rep: Strain; group: CellGroup }> = [];
  const phenotypeGroups = new Map<string, CellGroup>();
  const nextId = { genotype: 0, phenotype: 0 };

  const phenotypeOf = (strain: Strain): { key: string; label: string } => {
    const names = [...(strain.exprPhenotypeNames ?? [])].sort();
    if (strain.lethal === true) names.push('Lethal');
    let label = names.length === 0 ? 'Wild type' : names.join(', ');
    if (xLinked)
      label += strain.sex === Sex.Male ? ' (male)' : ' (hermaphrodite)';
    return { key: label, label };
  };

  const groupsOf = new Map<Strain, CellGroups>();
  strains.forEach((strain) => {
    let genotype = genotypeReps.find(({ rep }) => rep.equals(strain))?.group;
    if (genotype === undefined) {
      genotype = {
        id: nextId.genotype++,
        label: strain.genotype,
        count: 0,
        probability: 0,
      };
      genotypeReps.push({ rep: strain, group: genotype });
    }
    genotype.count += 1;
    genotype.probability += strain.probability ?? 0;

    const { key, label } = phenotypeOf(strain);
    let phenotype = phenotypeGroups.get(key);
    if (phenotype === undefined) {
      phenotype = { id: nextId.phenotype++, label, count: 0, probability: 0 };
      phenotypeGroups.set(key, phenotype);
    }
    phenotype.count += 1;
    phenotype.probability += strain.probability ?? 0;

    groupsOf.set(strain, { genotype, phenotype });
  });

  return cells.map((row) =>
    row.map((cell) => (cell === undefined ? undefined : groupsOf.get(cell)))
  );
};
