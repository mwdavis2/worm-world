import { describe, expect, test } from 'vitest';
import { type db_Allele } from 'models/db/db_Allele';
import { type db_Gene } from 'models/db/db_Gene';
import {
  MAX_RESULTS,
  searchAlleles,
  searchGenes,
  type AlleleEntry,
  type GeneEntry,
} from 'utils/searchIndex';

const geneEntry = (sys: string, desc: string | null): GeneEntry => {
  const gene: db_Gene = {
    sysName: sys,
    descName: desc,
    chromosome: 'X',
    physLoc: 1,
    geneticLoc: 1,
  };
  return { gene, desc: (desc ?? '').toLowerCase(), sys: sys.toLowerCase() };
};

const alleleEntry = (name: string, desc: string | null): AlleleEntry => {
  const allele: db_Allele = {
    name,
    contents: null,
    sysGeneName: 'G',
    variationName: null,
  };
  const gene: db_Gene = {
    sysName: 'G',
    descName: desc,
    chromosome: 'X',
    physLoc: 1,
    geneticLoc: 1,
  };
  return {
    allele,
    gene,
    name: name.toLowerCase(),
    desc: (desc ?? '').toLowerCase(),
  };
};

const names = (entries: GeneEntry[]): string[] =>
  entries.map((e) => e.gene.descName ?? e.gene.sysName);

describe('searchGenes', () => {
  const genes = [
    geneEntry('F1.1', 'lin-unc'),
    geneEntry('F2.2', 'unc-20'),
    geneEntry('UNC.7', 'dpy-7'),
    geneEntry('F3.3', 'unc-3'),
    geneEntry('F4.4', null),
  ];

  test('descriptive-name starts, then systematic-name starts, then contains; each in order', () => {
    expect(names(searchGenes(genes, 'unc').matches)).toEqual([
      'unc-20',
      'unc-3',
      'dpy-7', // its systematic name UNC.7 starts with it
      'lin-unc',
    ]);
  });

  test('ignores case and surrounding spaces, and a blank search finds nothing', () => {
    expect(names(searchGenes(genes, '  UNC-3 ').matches)).toEqual(['unc-3']);
    expect(searchGenes(genes, '   ')).toEqual({ matches: [], total: 0 });
  });

  test('finds a gene with no descriptive name by its systematic name', () => {
    expect(names(searchGenes(genes, 'f4').matches)).toEqual(['F4.4']);
  });

  test('a single character is enough', () => {
    expect(searchGenes(genes, 'u').total).toBe(4);
  });

  test('lists at most MAX_RESULTS but counts them all', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      geneEntry(`S${i}`, `unc-${i}`)
    );
    const result = searchGenes(many, 'unc');
    expect(result.matches).toHaveLength(MAX_RESULTS);
    expect(result.total).toBe(200);
  });
});

describe('searchAlleles', () => {
  const alleles = [
    alleleEntry('xed1', 'unc-119'),
    alleleEntry('ed2', 'unc-119'),
    alleleEntry('ox9', 'kin-20'),
    alleleEntry('oxIs12', null),
  ];
  const nameList = (
    text: string,
    include?: (a: db_Allele) => boolean
  ): string[] =>
    searchAlleles(alleles, text, include).matches.map((e) => e.allele.name);

  test('names (or gene names) that start with the text come first, each in name order', () => {
    expect(nameList('ed')).toEqual(['ed2', 'xed1']);
    expect(nameList('unc')).toEqual(['ed2', 'xed1']);
  });

  test('finds an allele with no gene by its own name', () => {
    expect(nameList('oxis')).toEqual(['oxIs12']);
  });

  test('include drops alleles before they are counted', () => {
    const result = searchAlleles(alleles, 'ox', (a) => a.name !== 'ox9');
    expect(result.matches.map((e) => e.allele.name)).toEqual(['oxIs12']);
    expect(result.total).toBe(1);
  });
});
