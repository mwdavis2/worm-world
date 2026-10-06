#!/usr/bin/env node
// The combined lin-15 gene as mutant and as rescue, as importable CSVs:
//
//   node scripts/build-lin-15.mjs
//
// Writes data/lin_15/{variations,phenotypes,alleles,allele_exprs,expr_relations}.csv
// (import in that order). lin-15 (ZK678.1&ZK662.4) is the shipped combined row
// for lin-15A and lin-15B together:
// - lin-15(n765ts) is a temperature-sensitive loss of function: a recessive
//   class-5 `Lin-15` phenotype rescued by the wild type, expressed only at 25C.
// - the integrated transgenes oxIs12 and oxIs644 rescue lin-15: each expresses
//   the wild-type `Lin-15` phenotype (`Lin-15` only, not `Lin-15A` and
//   `Lin-15B` separately). oxIs12 also expresses Punc-47::GFP.
// - oxIs363 is Punc-122::GFP and rescues unc-119 (wild `Unc-119`), not lin-15.
// oxIs644 already exists (its allele row is not regenerated; it is Lin-15(+)
// for now and will change with the Cre project); oxIs12 and oxIs363 have
// variation rows but no allele rows, so they get allele rows here.
// - unc-119(ed3), (ed4) and (ed9) are recessive class-5 `Unc-119` loss of
//   function alleles, rescued by the wild type.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const OUT_DIR = 'data/lin_15';
const GENE = 'ZK678.1&ZK662.4';
const UNC119_GENE = 'M142.1';
const PHENOTYPE = 'Lin-15';
const LOF_DOMINANCE = 4; // stored form of zygosity '5'
const DOMINANT_DOMINANCE = 2; // stored form of '1or2'

// [allele, gene, phenotype, the condition it needs ('' for none)]
const MUTANTS = [
  ['n765ts', GENE, PHENOTYPE, '25C'],
  ['ed3', UNC119_GENE, 'Unc-119', ''],
  ['ed4', UNC119_GENE, 'Unc-119', ''],
  ['ed9', UNC119_GENE, 'Unc-119', ''],
];
// Recessive class-5 alleles for the marker strains below ([allele, gene, the
// condition it needs]); lon-2(e678) and bli-4(e937) already exist in
// data/balancer_alleles.
const MARKER_ALLELES = [
  ['e61', 'dpy-5'],
  ['e187', 'rol-6'],
  ['e1820', 'lon-1'],
  ['sc16', 'bli-6'],
  ['e224', 'dpy-11'],
  ['e936', 'unc-73'],
  ['e491', 'sma-3'],
  ['e1562', 'vab-7'],
  ['e928', 'unc-31'],
  ['e1368ts', 'daf-2', '25C'], // temperature sensitive: needs the condition
  ['e53', 'unc-5'],
  ['ox171', 'unc-5'],
  ['e66', 'unc-22'],
  ['e1282', 'dpy-20', '25C'], // already in the database without a phenotype
  ['ox819', 'unc-119'],
  ['md299', 'unc-18'],
  // already in the database without a phenotype (BT14 uses e138 and hd43)
  ['e138', 'unc-24'],
  ['hd43', 'fbl-1', '', { femaleSterile: 1 }],
  ['e1415', 'dpy-20'], // not temperature sensitive, unlike e1282
];
// Alleles that already exist (data/balancer_alleles, data/translocations or the
// live database): only their genotype label and map position are needed here.
const EXISTING = [
  ['e1107', 'tra-3'],
  ['e12', 'dpy-9'],
  ['ox1059', 'kin-4'],
];
// [name, members]: a member is an allele (homozygous) or { name, onTop, onBot }
const hetTop = (name) => ({ name, onTop: true, onBot: false });
const hetBot = (name) => ({ name, onTop: false, onBot: true });
const STRAINS = [
  ['EG1306', ['oxIs12', 'n765ts']],
  ['EG5071', ['ed3', 'oxIs363']],
  ['EG9934', ['oxIs644', 'n765ts']],
  ['EG1000', ['e61', 'e187', 'e1820']],
  ['EG1020', ['sc16', 'e224', 'e678']],
  ['154', ['e936', 'e491', 'sc16']],
  ['155', ['e936', 'e224', 'e678']],
  ['DA438', ['e937', 'e187', 'e1368ts', 'e1562', 'e928', 'e224', 'e678']],
  ['NK785', ['ed4', hetTop('qyEx127')]],
  ['EG3123', ['ed9']],
  ['CB3988', [hetTop('e1107'), hetBot('nT1(IV)'), hetBot('nT1vul'), hetBot('nT1(V)')]],
  ['CB2223', ['e53', 'e1282']],
  ['EG10401', ['ox171', 'e1166sd']],
  ['EG10402', ['e12', 'ox171']],
  ['EG10403', ['ox496', 'ox171']],
  ['EG10404', ['e66', 'e1166sd']],
  ['EG10405', ['e12', 'e66']],
  ['EG10406', ['ox496', 'e66']],
  ['EG10105', ['ed3', 'oxIs644', hetTop('oxEx2254')]],
  ['EG10114', ['ox1059']],
  ['EG9965', ['oxSi1168', 'ox819', 'oxTi1127']],
  ['EG7841', ['oxTi302', 'ed3']],
  ['EG7764', ['oxTi75', 'md299']],
];
const CHROMOSOME_ORDER = ['I', 'II', 'III', 'IV', 'V', 'X', 'Ex'];
const NEW_RESCUES = [
  ['oxIs12', 'X'],
  ['oxIs363', 'IV'],
]; // [allele, chromosome] - variation and allele rows are written
const TRANSGENE_EXPRS = [
  ['oxIs12', 'Punc-47::GFP', 0],
  ['oxIs12', PHENOTYPE, 1],
  ['oxIs363', 'Punc-122::GFP', 0],
  ['oxIs363', 'Unc-119', 1],
  ['oxIs644', PHENOTYPE, 1],
  ['oxIs644', 'Peft-3::citrine::NLS', 0], // only with Flp, see below
  ['oxTi302', 'Unc-119', 1],
  ['oxTi75', 'Peft-3::GFP::H2B', 0],
  ['oxTi75', 'Unc-18', 1],
  ['oxEx2254', 'Unc-119', 1],
]; // [allele, phenotype, wild]

const csvEscape = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const toCsv = (header, rows) =>
  [header, ...rows.map((r) => header.map((h) => r[h] ?? ''))].map((r) => r.map(csvEscape).join(',')).join('\n') + '\n';

const genes = readFileSync('src-tauri/seed/genes.csv', 'utf8').split('\n');
[GENE, UNC119_GENE].forEach((gene) => {
  if (!genes.some((line) => line.startsWith(`${gene},`))) {
    console.error(`The shipped gene table has no ${gene} row`);
    process.exit(1);
  }
});
const conditions = readFileSync('src-tauri/seed/conditions.csv', 'utf8').split('\n');
MUTANTS.forEach(([, , , condition]) => {
  if (condition && !conditions.some((line) => line.startsWith(`${condition},`))) {
    console.error(`The shipped conditions have no ${condition}`);
    process.exit(1);
  }
});

// oxIs12 sits 1 cM left of lin-15 on X; its physical position is interpolated
// between the nearest shipped genes either side of that map position.
const OXIS12_CM = Number(genes.find((line) => line.startsWith(`${GENE},`)).split(',')[4]) - 1;
const physicalAt = (chr, cm) => {
  const anchors = genes
    .map((line) => line.split(','))
    .filter((r) => r[2] === chr && r[3] && r[4] !== undefined && r[4] !== '' && !Number.isNaN(Number(r[4])))
    .map((r) => [Number(r[3]), Number(r[4])]);
  const left = anchors.filter(([, g]) => g <= cm).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  const right = anchors.filter(([, g]) => g > cm).sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
  return Math.round(left[0] + ((cm - left[1]) / (right[1] - left[1])) * (right[0] - left[0]));
};
// oxIs363 is inserted at the cxTi10882 site (IV:4,237,767), so it takes that
// physical position; its map position is interpolated from the shipped genes.
const OXIS363_PHYS = 4237767;
const geneticAt = (chr, phys) => {
  const anchors = genes
    .map((line) => line.split(','))
    .filter((r) => r[2] === chr && r[3] && r[4] !== undefined && r[4] !== '' && !Number.isNaN(Number(r[4])))
    .map((r) => [Number(r[3]), Number(r[4])]);
  const left = anchors.filter(([p]) => p <= phys).sort((a, b) => b[0] - a[0] || b[1] - a[1])[0];
  const right = anchors.filter(([p]) => p > phys).sort((a, b) => a[0] - b[0] || a[1] - b[1])[0];
  return left[1] + ((phys - left[0]) / (right[0] - left[0])) * (right[1] - left[1]);
};
const POSITIONS = {
  oxIs12: ['X', physicalAt('X', OXIS12_CM), OXIS12_CM],
  oxIs363: ['IV', OXIS363_PHYS, geneticAt('IV', OXIS363_PHYS)],
}; // [chromosome, physical, genetic]

const variations = NEW_RESCUES.map(([name, chromosome]) => ({
  alleleName: name,
  chromosome,
  physLoc: POSITIONS[name] ? POSITIONS[name][1] : '',
  geneticLoc: POSITIONS[name] ? Math.round(POSITIONS[name][2] * 10000) / 10000 : '',
  recombSuppressorStart: '',
  recombSuppressorEnd: '',
  isLocationReference: 'false',
  percentLoss: '',
}));
const phenotype = (name, wild, lethal, flags = {}) => ({
  name,
  wild,
  short_name: name,
  description: '',
  male_mating: '',
  lethal,
  female_sterile: flags.femaleSterile ?? '',
  arrested: '',
  maturation_days: '',
});
const phenotypes = [
  phenotype(PHENOTYPE, 0, 0),
  phenotype(PHENOTYPE, 1, ''),
  phenotype('Unc-119', 0, 0),
  phenotype('Unc-119', 1, ''),
  phenotype('Punc-47::GFP', 0, 0),
  phenotype('Punc-122::GFP', 0, 0),
  phenotype('Peft-3::citrine::NLS', 0, 0),
  phenotype('Flp', 1, ''),
  phenotype('Peft-3::GFP::H2B', 0, 0),
  phenotype('Pmyo-2::nls-CyOFP', 0, 0),
];
const alleles = [
  ...MUTANTS.map(([name, gene]) => ({ name, contents: '', sysGeneName: gene, variationName: '' })),
  ...NEW_RESCUES.map(([name]) => ({ name, contents: '', sysGeneName: '', variationName: name })),
];
const alleleExprs = [
  ...MUTANTS.map(([name, , phenotypeName]) => ({ alleleName: name, expressingPhenotypeName: phenotypeName, expressingPhenotypeWild: 0, dominance: LOF_DOMINANCE })),
  ...TRANSGENE_EXPRS.map(([name, phenotypeName, wild]) => ({ alleleName: name, expressingPhenotypeName: phenotypeName, expressingPhenotypeWild: wild, dominance: DOMINANT_DOMINANCE })),
];
const exprRelations = MUTANTS.flatMap(([name, , phenotypeName, condition]) => [
  {
    allele_name: name,
    expressing_phenotype_name: phenotypeName,
    expressing_phenotype_wild: 0,
    altering_phenotype_name: phenotypeName,
    altering_phenotype_wild: 1,
    altering_condition: '',
    is_suppressing: 1,
  },
  ...(condition
    ? [
        {
          allele_name: name,
          expressing_phenotype_name: phenotypeName,
          expressing_phenotype_wild: 0,
          altering_phenotype_name: '',
          altering_phenotype_wild: '',
          altering_condition: condition,
          is_suppressing: 0,
        },
      ]
    : []),
]);


// oxIs644 has no fluorescence of its own: its citrine::NLS shows only when Flp
// is expressed (by oxEx2254, say), so the expression requires the wild Flp.
exprRelations.push({
  allele_name: 'oxIs644',
  expressing_phenotype_name: 'Peft-3::citrine::NLS',
  expressing_phenotype_wild: 0,
  altering_phenotype_name: 'Flp',
  altering_phenotype_wild: 1,
  altering_condition: '',
  is_suppressing: 0,
});

// Marker alleles: each is an allele of its gene with a capitalized recessive
// class-5 phenotype rescued by the wild type.
const geneRows = genes.map((line) => line.split(','));
const geneNamed = (desc) => {
  const rows = geneRows.filter((r) => r[1] === desc);
  if (rows.length !== 1) {
    console.error(`Expected one shipped gene named ${desc}, found ${rows.length}`);
    process.exit(1);
  }
  const [sys, , chr, , gen] = rows[0];
  return { sys, desc, chr, gen: Number(gen) };
};
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const info = new Map(); // allele -> { label, chr, gen } for the genotype text
MUTANTS.forEach(([name, sys]) => {
  const gene = geneRows.find((r) => r[0] === sys);
  info.set(name, { label: `${gene[1]}(${name})`, chr: gene[2], gen: Number(gene[4]) });
});
info.set('e678', { label: 'lon-2(e678)', ...(({ chr, gen }) => ({ chr, gen }))(geneNamed('lon-2')) });
info.set('e937', { label: 'bli-4(e937)', ...(({ chr, gen }) => ({ chr, gen }))(geneNamed('bli-4')) });
info.set('oxIs12', { label: 'oxIs12', chr: 'X', gen: OXIS12_CM });
// oxIs644 is on IV at 0 cM (its variation row already exists in the database)
info.set('oxIs644', { label: 'oxIs644', chr: 'IV', gen: 0 });
info.set('oxIs363', { label: 'oxIs363', chr: 'IV', gen: POSITIONS.oxIs363[2] });
MARKER_ALLELES.forEach(([allele, geneName, condition, flags = {}]) => {
  const gene = geneNamed(geneName);
  const phenotypeName = capitalize(gene.desc);
  alleles.push({ name: allele, contents: '', sysGeneName: gene.sys, variationName: '' });
  phenotypes.push(phenotype(phenotypeName, 0, 0, flags), phenotype(phenotypeName, 1, ''));
  alleleExprs.push({ alleleName: allele, expressingPhenotypeName: phenotypeName, expressingPhenotypeWild: 0, dominance: LOF_DOMINANCE });
  exprRelations.push({
    allele_name: allele,
    expressing_phenotype_name: phenotypeName,
    expressing_phenotype_wild: 0,
    altering_phenotype_name: phenotypeName,
    altering_phenotype_wild: 1,
    altering_condition: '',
    is_suppressing: 1,
  });
  if (condition) {
    if (!conditions.some((line) => line.startsWith(`${condition},`))) {
      console.error(`The shipped conditions have no ${condition}`);
      process.exit(1);
    }
    exprRelations.push({
      allele_name: allele,
      expressing_phenotype_name: phenotypeName,
      expressing_phenotype_wild: 0,
      altering_phenotype_name: '',
      altering_phenotype_wild: '',
      altering_condition: condition,
      is_suppressing: 0,
    });
  }
  info.set(allele, { label: `${gene.desc}(${allele})`, chr: gene.chr, gen: gene.gen });
});

// transgene alleles that exist only in the database (all placed alone on their chromosome)
[['oxTi302', 'I'], ['oxTi75', 'II'], ['oxSi1168', 'II'], ['oxEx2254', 'Ex']].forEach(([allele, chr]) =>
  info.set(allele, { label: allele, chr, gen: undefined })
);
EXISTING.forEach(([allele, geneName]) => {
  const gene = geneNamed(geneName);
  info.set(allele, { label: `${gene.desc}(${allele})`, chr: gene.chr, gen: gene.gen });
});
// the nT1 translocation and its egl-18(nT1vul) allele (data/translocations,
// data/balancer_alleles)
{
  const row = (name) => readFileSync('data/translocations/variations.csv', 'utf8').split('\n').map((l) => l.split(',')).find((r) => r[0] === name);
  const iv = row('nT1(IV)');
  const v = row('nT1(V)');
  const egl18 = geneNamed('egl-18');
  info.set('nT1(IV)', { label: 'nT1(IV)', chr: 'IV', gen: Number(iv[3]) });
  info.set('nT1(V)', { label: 'nT1(V)', chr: 'V', gen: Number(v[3]) });
  info.set('nT1vul', { label: 'egl-18(nT1vul)', chr: 'IV', gen: egl18.gen });
}

// Semidominant alleles: one copy gives the weak phenotype, two give the strong
// one, and the wild-type phenotype rescues both.
// [allele, gene, weak phenotype, strong phenotype, wild phenotype]
[
  ['e1166sd', 'dpy-4', 'Dpy-4(weak)', 'Dpy-4(strong)', 'Dpy-4'],
  ['n498', 'unc-43', 'Unc-43_paralyzed(weak)', 'Unc-43_paralyzed', 'Unc-43'],
].forEach(([allele, geneName, weak, strong, wild]) => {
  const gene = geneNamed(geneName);
  alleles.push({ name: allele, contents: '', sysGeneName: gene.sys, variationName: '' });
  phenotypes.push(phenotype(weak, 0, 0), phenotype(strong, 0, 0), phenotype(wild, 1, ''));
  [[weak, 1], [strong, 0]].forEach(([name, dominance]) => {
    alleleExprs.push({ alleleName: allele, expressingPhenotypeName: name, expressingPhenotypeWild: 0, dominance });
    exprRelations.push({
      allele_name: allele,
      expressing_phenotype_name: name,
      expressing_phenotype_wild: 0,
      altering_phenotype_name: wild,
      altering_phenotype_wild: 1,
      altering_condition: '',
      is_suppressing: 1,
    });
  });
  info.set(allele, { label: `${gene.desc}(${allele})`, chr: gene.chr, gen: gene.gen });
});

// Neomycin resistance in the drug-resistance pattern (see
// build-inversion-balancers.mjs): resistant needs the drug; without the wild
// copy the animal dies on it.
const addDrugResistance = (allele, drug) => {
  const resistance = `${drug}R`;
  phenotypes.push(phenotype(resistance, 0, 0), phenotype(resistance, 1, 1));
  alleleExprs.push(
    { alleleName: allele, expressingPhenotypeName: resistance, expressingPhenotypeWild: 0, dominance: DOMINANT_DOMINANCE },
    { alleleName: allele, expressingPhenotypeName: resistance, expressingPhenotypeWild: 1, dominance: 3 } // stored form of '0' copies
  );
  const relation = (wild, alteringName, alteringWild, condition, isSuppressing) =>
    exprRelations.push({
      allele_name: allele,
      expressing_phenotype_name: resistance,
      expressing_phenotype_wild: wild,
      altering_phenotype_name: alteringName,
      altering_phenotype_wild: alteringWild,
      altering_condition: condition,
      is_suppressing: isSuppressing,
    });
  relation(1, resistance, 0, '', 1);
  relation(1, '', '', drug, 0);
  relation(0, '', '', drug, 0);
};

// dpy-13(ox496) is a neo insertion: recessive Dpy-13 and neomycin resistance.
{
  const gene = geneNamed('dpy-13');
  alleles.push({ name: 'ox496', contents: '[NeoR]', sysGeneName: gene.sys, variationName: '' });
  phenotypes.push(phenotype('Dpy-13', 0, 0), phenotype('Dpy-13', 1, ''));
  alleleExprs.push({ alleleName: 'ox496', expressingPhenotypeName: 'Dpy-13', expressingPhenotypeWild: 0, dominance: LOF_DOMINANCE });
  exprRelations.push({
    allele_name: 'ox496',
    expressing_phenotype_name: 'Dpy-13',
    expressing_phenotype_wild: 0,
    altering_phenotype_name: 'Dpy-13',
    altering_phenotype_wild: 1,
    altering_condition: '',
    is_suppressing: 1,
  });
  addDrugResistance('ox496', 'Neomycin');
  info.set('ox496', { label: 'dpy-13(ox496)', chr: gene.chr, gen: gene.gen });
}
// oxEx2254 (already in the database) carries NeoR too
addDrugResistance('oxEx2254', 'Neomycin');

// F53A2.9(oxTi1127) is a single-copy insertion in F53A2.9 that carries Cas9,
// Cre and a Pmyo-2 nls-CyOFP marker.
{
  const gene = geneNamed('F53A2.9');
  alleles.push({
    name: 'oxTi1127',
    contents: "[Pmex-5::Cas9::tbb-2 3'UTR; Phsp-16.41::Cre::tbb-2 3'UTR; Pmyo-2::lnls-CyOFP::let-858 3'UTR + lox2272 lox2272]",
    sysGeneName: gene.sys,
    variationName: '',
  });
  alleleExprs.push({ alleleName: 'oxTi1127', expressingPhenotypeName: 'Pmyo-2::nls-CyOFP', expressingPhenotypeWild: 0, dominance: DOMINANT_DOMINANCE });
  info.set('oxTi1127', { label: 'F53A2.9(oxTi1127)', chr: gene.chr, gen: gene.gen });
}

// qyEx127 is an extrachromosomal array carrying Pced-5::GFP and unc-119(+)
variations.push({
  alleleName: 'qyEx127',
  chromosome: 'Ex',
  physLoc: '',
  geneticLoc: '',
  recombSuppressorStart: '',
  recombSuppressorEnd: '',
  isLocationReference: 'false',
  percentLoss: '',
});
alleles.push({ name: 'qyEx127', contents: '', sysGeneName: '', variationName: 'qyEx127' });
phenotypes.push(phenotype('Pced-5::GFP', 0, 0));
alleleExprs.push(
  { alleleName: 'qyEx127', expressingPhenotypeName: 'Pced-5::GFP', expressingPhenotypeWild: 0, dominance: DOMINANT_DOMINANCE },
  { alleleName: 'qyEx127', expressingPhenotypeName: 'Unc-119', expressingPhenotypeWild: 1, dominance: DOMINANT_DOMINANCE }
);
info.set('qyEx127', { label: 'qyEx127', chr: 'Ex', gen: undefined });

// Strains. The genotype text is built the way Strain.toString does:
// chromosomes in order, the pairs of each sorted by genetic position (an allele
// with no position sorts last); a chromosome that is all homozygous reads
// "<alleles> <chromosome>", otherwise "<top>/<bottom> <chromosome>" with + for a
// wild copy, flipped so the first top is not wild; an array reads "array/+ Ex".
const strains = [];
const strainAlleles = [];
STRAINS.forEach(([name, rawMembers]) => {
  const members = rawMembers.map((m) => (typeof m === 'string' ? { name: m, onTop: true, onBot: true } : m));
  const byChr = new Map();
  members.forEach((member) => {
    const item = info.get(member.name);
    if (!item) {
      console.error(`${name}: allele ${member.name} is not defined`);
      process.exit(1);
    }
    byChr.set(item.chr, [...(byChr.get(item.chr) ?? []), { ...item, onTop: member.onTop, onBot: member.onBot }]);
  });
  const parts = CHROMOSOME_ORDER.filter((chr) => byChr.has(chr)).map((chr) => {
    const items = byChr.get(chr);
    if (chr === 'Ex') return `${items.map((i) => i.label).join(' ')}/${items.map(() => '+').join(' ')} Ex`;
    items.sort((a, b) => (a.gen ?? 50) - (b.gen ?? 50));
    let pairs = items.map((i) => ({ top: i.onTop ? i.label : '+', bot: i.onBot ? i.label : '+' }));
    if (pairs.every((pair) => pair.top === pair.bot)) return `${pairs.map((pair) => pair.top).join(' ')} ${chr}`;
    if (pairs[0].top === '+') pairs = pairs.map((pair) => ({ top: pair.bot, bot: pair.top }));
    return `${pairs.map((pair) => pair.top).join(' ')}/${pairs.map((pair) => pair.bot).join(' ')} ${chr}`;
  });
  const labelsOf = (list) => list.map((m) => info.get(m.name).label).join(' ');
  const homozygous = members.filter((m) => m.onTop && m.onBot);
  const topOnly = members.filter((m) => m.onTop && !m.onBot);
  const botOnly = members.filter((m) => !m.onTop && m.onBot);
  const description =
    topOnly.length + botOnly.length === 0
      ? `${labelsOf(homozygous)} homozygous.`
      : `${labelsOf(homozygous)}${homozygous.length > 0 ? ' homozygous with ' : ''}${labelsOf(topOnly)}${botOnly.length > 0 ? ` over ${labelsOf(botOnly)}` : ' on one homolog'}.`;
  strains.push({ name, genotype: `${parts.join('; ')}.`, description });
  members.forEach((member) =>
    strainAlleles.push({ strainName: name, alleleName: member.name, isOnTop: String(member.onTop), isOnBot: String(member.onBot) })
  );
});

mkdirSync(OUT_DIR, { recursive: true });
const write = (file, header, rows) => {
  writeFileSync(`${OUT_DIR}/${file}`, toCsv(header, rows));
  console.log(`${file}: ${rows.length} rows`);
};
write('variations.csv', ['alleleName', 'chromosome', 'physLoc', 'geneticLoc', 'recombSuppressorStart', 'recombSuppressorEnd', 'isLocationReference', 'percentLoss'], variations);
// two alleles of one gene (e53 and ox171) ask for the same phenotype rows
const uniquePhenotypes = [...new Map(phenotypes.map((p) => [`${p.name}|${p.wild}`, p])).values()];
write('phenotypes.csv', ['name', 'wild', 'short_name', 'description', 'male_mating', 'lethal', 'female_sterile', 'arrested', 'maturation_days'], uniquePhenotypes);
write('alleles.csv', ['name', 'contents', 'sysGeneName', 'variationName'], alleles);
write('allele_exprs.csv', ['alleleName', 'expressingPhenotypeName', 'expressingPhenotypeWild', 'dominance'], alleleExprs);
write('expr_relations.csv', ['allele_name', 'expressing_phenotype_name', 'expressing_phenotype_wild', 'altering_phenotype_name', 'altering_phenotype_wild', 'altering_condition', 'is_suppressing'], exprRelations);
write('strains.csv', ['name', 'genotype', 'description'], strains);
write('strain_alleles.csv', ['strainName', 'alleleName', 'isOnTop', 'isOnBot'], strainAlleles);
