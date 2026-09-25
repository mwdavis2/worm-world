import { type ChromosomeName } from 'models/db/filter/db_ChromosomeName';
import { Dominance } from 'models/enums';
import { type Gene } from 'models/frontend/Gene/Gene';

export type AlleleTab = 'gene' | 'tiSiIs' | 'ex';

export type CopyNumber = '0' | '1' | '2' | '1or2';

export type PhenotypeRelationship =
  | 'suppressedByPhenotype'
  | 'requiresPhenotype'
  | 'suppressedByCondition'
  | 'requiresCondition';

// Tags a row as synthesized by a specific Basic control, so toggling that
// control off can remove exactly its own rows without touching manually-
// added/edited ones. undefined = a default or manually-added/edited row.
export type PhenotypeRowSource =
  | 'resistantToDrug'
  | 'dominance'
  | 'rescuesGene'
  | 'fluorescentMarker';

export interface PhenotypeRowState {
  id: string;
  copyNumber: CopyNumber;
  name: string;
  isWildType: boolean;
  isLethal: boolean;
  relationship?: PhenotypeRelationship;
  relationshipText: string;
  derivedFrom?: PhenotypeRowSource;
}

export const defaultPhenotypeRow = (id: string): PhenotypeRowState => ({
  id,
  copyNumber: '2',
  name: '',
  isWildType: false,
  isLethal: false,
  relationship: 'suppressedByPhenotype',
  relationshipText: '',
});

export interface ResistantToDrugState {
  enabled: boolean;
  drugName?: string;
}

export const defaultResistantToDrugState = (): ResistantToDrugState => ({
  enabled: false,
  drugName: undefined,
});

export interface RescuesGeneState {
  enabled: boolean;
  gene?: Gene;
  geneName: string;
}

export const defaultRescuesGeneState = (): RescuesGeneState => ({
  enabled: false,
  gene: undefined,
  geneName: '',
});

export interface FluorescentMarkerState {
  enabled: boolean;
  text: string;
  twoCopiesBrighter: boolean;
}

export const defaultFluorescentMarkerState = (): FluorescentMarkerState => ({
  enabled: false,
  text: '',
  twoCopiesBrighter: false,
});

export interface ZygosityBoxState {
  name: string;
  rescuedByWT: boolean;
}

export const defaultZygosityBoxState = (): ZygosityBoxState => ({
  name: '',
  rescuedByWT: true,
});

// Gene tab only.
export interface DominanceState {
  enabled: boolean;
  mode: Dominance;
  // Recessive: only `homozygous` is shown (as the "-/-", 2-copies box).
  // Dominant: only `homozygous` is shown (as the combined "1 or 2 copies" box).
  // SemiDominant: both boxes are shown ("-/-" 2 copies, "+/-" 1 copy).
  // Known, explicitly out-of-scope gap: no box exists for the "0 copies" state.
  homozygous: ZygosityBoxState;
  heterozygous: ZygosityBoxState;
}

export const defaultDominanceState = (): DominanceState => ({
  enabled: false,
  mode: Dominance.Recessive,
  homozygous: defaultZygosityBoxState(),
  heterozygous: defaultZygosityBoxState(),
});

export interface GeneTabState {
  name: string; // classic allele designation, e.g. "ed3" - gene tab only
  gene?: Gene;
  qualifiers: string;
  phenotypeRows: PhenotypeRowState[];
  resistantToDrug: ResistantToDrugState;
  dominance: DominanceState;
  rescuesGene: RescuesGeneState;
  fluorescentMarker: FluorescentMarkerState;
}

export const defaultGeneTabState = (): GeneTabState => ({
  name: '',
  gene: undefined,
  qualifiers: '',
  phenotypeRows: [defaultPhenotypeRow('default')],
  resistantToDrug: defaultResistantToDrugState(),
  dominance: defaultDominanceState(),
  rescuesGene: defaultRescuesGeneState(),
  fluorescentMarker: defaultFluorescentMarkerState(),
});

// Shared shape for the Ti/Si/Is and Ex tabs.
export interface VariationTabState {
  namePrefix: string; // lowercase alphabetic only
  nameSuffix: string; // numeric only
  namingPrefix?: 'Ti' | 'Si' | 'Is'; // tiSiIs only - Ex's middle segment is fixed
  chromosome?: ChromosomeName; // tiSiIs only - Ex has no chromosome
  positionMode: 'physical' | 'genetic'; // tiSiIs only
  positionValue?: number; // tiSiIs only
  percentLoss?: number; // ex only
  qualifiers: string;
  phenotypeRows: PhenotypeRowState[];
  resistantToDrug: ResistantToDrugState;
  rescuesGene: RescuesGeneState;
  fluorescentMarker: FluorescentMarkerState;
}

export const defaultVariationTabState = (): VariationTabState => ({
  namePrefix: '',
  nameSuffix: '',
  namingPrefix: 'Ti',
  chromosome: undefined,
  positionMode: 'physical',
  positionValue: undefined,
  percentLoss: 50,
  qualifiers: '',
  phenotypeRows: [defaultPhenotypeRow('default')],
  resistantToDrug: defaultResistantToDrugState(),
  rescuesGene: defaultRescuesGeneState(),
  fluorescentMarker: defaultFluorescentMarkerState(),
});

// Replaces exactly the rows tagged with `source` (leaving manually-added/
// edited rows - derivedFrom undefined - and every other tag's rows alone).
export const replaceTaggedRows = (
  rows: PhenotypeRowState[],
  source: NonNullable<PhenotypeRowState['derivedFrom']>,
  newRows: PhenotypeRowState[]
): PhenotypeRowState[] => [
  ...rows.filter((row) => row.derivedFrom !== source),
  ...newRows,
];

export const computeResistantToDrugRows = (
  state: ResistantToDrugState
): PhenotypeRowState[] => {
  if (!state.enabled || state.drugName === undefined || state.drugName === '')
    return [];
  const drug = state.drugName;
  return [
    {
      id: 'resistantToDrug-0',
      copyNumber: '0',
      name: `${drug}S`,
      isWildType: false,
      isLethal: true,
      relationship: 'suppressedByPhenotype',
      relationshipText: `${drug}R`,
      derivedFrom: 'resistantToDrug',
    },
    {
      id: 'resistantToDrug-1or2',
      copyNumber: '1or2',
      name: `${drug}R`,
      isWildType: true,
      isLethal: false,
      relationship: 'requiresCondition',
      relationshipText: drug,
      derivedFrom: 'resistantToDrug',
    },
  ];
};

export const computeRescuesGeneRows = (
  state: RescuesGeneState
): PhenotypeRowState[] => {
  if (!state.enabled || state.geneName === '') return [];
  return [
    {
      id: 'rescuesGene-0',
      copyNumber: '1or2',
      name: `${state.geneName}(+)`,
      isWildType: true,
      isLethal: false,
      relationshipText: '',
      derivedFrom: 'rescuesGene',
    },
  ];
};

export const computeFluorescentMarkerRows = (
  state: FluorescentMarkerState
): PhenotypeRowState[] => {
  if (!state.enabled || state.text === '') return [];
  if (!state.twoCopiesBrighter) {
    return [
      {
        id: 'fluorescentMarker-0',
        copyNumber: '1or2',
        name: state.text,
        isWildType: false,
        isLethal: false,
        relationshipText: '',
        derivedFrom: 'fluorescentMarker',
      },
    ];
  }
  return [
    {
      id: 'fluorescentMarker-dim',
      copyNumber: '1',
      name: `${state.text} (dim)`,
      isWildType: false,
      isLethal: false,
      relationshipText: '',
      derivedFrom: 'fluorescentMarker',
    },
    {
      id: 'fluorescentMarker-bright',
      copyNumber: '2',
      name: state.text,
      isWildType: false,
      isLethal: false,
      relationshipText: '',
      derivedFrom: 'fluorescentMarker',
    },
  ];
};

export const computeDominanceRows = (
  state: DominanceState,
  geneName: string
): PhenotypeRowState[] => {
  if (!state.enabled) return [];
  const boxRow = (
    copyNumber: CopyNumber,
    box: ZygosityBoxState,
    idSuffix: string
  ): PhenotypeRowState | undefined => {
    if (box.name === '') return undefined;
    return {
      id: `dominance-${idSuffix}`,
      copyNumber,
      name: box.name,
      isWildType: false,
      isLethal: false,
      relationship: box.rescuedByWT ? 'suppressedByPhenotype' : undefined,
      relationshipText: box.rescuedByWT ? `${geneName}(+)` : '',
      derivedFrom: 'dominance',
    };
  };

  const rows: PhenotypeRowState[] = [];
  if (state.mode === Dominance.Recessive) {
    const row = boxRow('2', state.homozygous, 'homo');
    if (row !== undefined) rows.push(row);
  } else if (state.mode === Dominance.Dominant) {
    const row = boxRow('1or2', state.homozygous, 'homo');
    if (row !== undefined) rows.push(row);
  } else {
    const homoRow = boxRow('2', state.homozygous, 'homo');
    if (homoRow !== undefined) rows.push(homoRow);
    const heteroRow = boxRow('1', state.heterozygous, 'hetero');
    if (heteroRow !== undefined) rows.push(heteroRow);
  }
  return rows;
};

// Recomputes the full Phenotype-row list purely from the tab's current
// Basic-control state, ignoring whatever's currently in `phenotypeRows` -
// used both to live-sync `phenotypeRows` on every Basic control change, and
// (critically) to recompute fresh at submit time when Basic is the active
// view, per the active-tab-governs-submission rule.
export const deriveRowsFromBasicState = (
  tab: AlleleTab,
  state: GeneTabState | VariationTabState,
  geneNameForDominance: string
): PhenotypeRowState[] => {
  const rows = [
    ...computeResistantToDrugRows(state.resistantToDrug),
    ...computeRescuesGeneRows(state.rescuesGene),
    ...computeFluorescentMarkerRows(state.fluorescentMarker),
  ];
  if (tab === 'gene') {
    rows.push(
      ...computeDominanceRows(
        (state as GeneTabState).dominance,
        geneNameForDominance
      )
    );
  }
  return rows;
};

export const buildAlleleName = (
  tab: 'tiSiIs' | 'ex',
  state: VariationTabState
): string => {
  const middle = tab === 'ex' ? 'Ex' : state.namingPrefix ?? '';
  return `${state.namePrefix}${middle}${state.nameSuffix}`;
};

export interface ParsedInitialAlleleName {
  tab: AlleleTab;
  plainName?: string; // gene tab only
  namePrefix?: string; // tiSiIs/ex only
  namingPrefix?: 'Ti' | 'Si' | 'Is'; // tiSiIs only
  nameSuffix?: string; // tiSiIs/ex only
}

// Inverse of buildAlleleName - given whatever the user typed into the
// allele-search box before requesting a new allele, figures out which tab
// it actually belongs to and how to split it, rather than always dumping
// the raw string into the Gene tab's plain designation field (which is
// wrong whenever the typed name is actually a Ti/Si/Is/Ex-style name).
export const parseInitialAlleleName = (
  input: string
): ParsedInitialAlleleName => {
  // A user padding the search text with a trailing/leading space (e.g. to
  // dodge a substring-matching existing allele and get "+ New allele" to
  // show) shouldn't defeat routing - trim before matching.
  const trimmed = input.trim();
  const match = /^([a-z]+)(Ti|Si|Is|Ex)(\d+)$/.exec(trimmed);
  if (match === null) return { tab: 'gene', plainName: trimmed };
  const [, namePrefix, marker, nameSuffix] = match;
  if (marker === 'Ex') return { tab: 'ex', namePrefix, nameSuffix };
  return {
    tab: 'tiSiIs',
    namePrefix,
    namingPrefix: marker as 'Ti' | 'Si' | 'Is',
    nameSuffix,
  };
};
