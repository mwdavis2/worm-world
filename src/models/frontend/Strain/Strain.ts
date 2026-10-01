import { getAllele } from 'api/allele';
import {
  deleteFilteredStrainAlleles,
  getFilteredStrainAlleles,
  insertDbStrainAllele,
} from 'api/strainAllele';
import {
  Exclude,
  Transform,
  Type,
  instanceToPlain,
  plainToInstance,
} from 'class-transformer';
import { type db_Strain } from 'models/db/db_Strain';
import { type FilterGroup } from 'models/db/filter/FilterGroup';
import { type StrainAlleleFieldName } from 'models/db/filter/db_StrainAlleleFieldName';
import { Sex } from 'models/enums';
import { Allele } from 'models/frontend/Allele/Allele';
import { type AlleleExpression } from 'models/frontend/AlleleExpression/AlleleExpression';
import { AllelePair } from 'models/frontend/AllelePair/AllelePair';
import { type Condition } from 'models/frontend/Condition/Condition';
import { Phenotype } from 'models/frontend/Phenotype/Phenotype';
import { getStrain, insertStrain, updateStrain } from 'api/strain';
import { type ChromosomeName } from 'models/db/filter/db_ChromosomeName';
import {
  type ChromosomeOption,
  type ChromosomePairOption,
  ChromosomePair,
} from 'models/frontend/ChromosomePair/ChromosomePair';
import { chromosomes } from 'models/frontend/Chromosome';
import type StrainFilter from 'models/frontend/StrainFilter/StrainFilter';

export interface Gamete {
  chromosomes: Allele[][];
  prob: number;
}

interface IStrain {
  name?: string;
  chromPairMap?: Map<ChromosomeName | undefined, ChromosomePair>; // Has priority over allelePairs
  allelePairs?: AllelePair[];
  genotype?: string;
  description?: string;
  sex?: Sex;
  isParent?: boolean;
  isChild?: boolean;
  probability?: number;
  filteredProbability?: number;
}

/**
 * A genetic profile consisting of an ordered sequence allele pairs.
 */
export class Strain {
  public name = '';
  public sex = Sex.Hermaphrodite;
  public isParent = false;
  public isChild = false;
  public genotype: string = '.';

  public description?: string;
  public probability: number = 1;
  // Set only when some sibling of this genotype (same Cross/SelfCross) is
  // currently filtered out - the renormalized share of just the visible
  // siblings. Undefined (not shown) whenever nothing in the group is hidden,
  // since it would then equal `probability` and be pure clutter to repeat.
  public filteredProbability?: number;
  // Whether this genotype expresses a lethal phenotype, as last resolved by
  // the Editor against its cross's parent alleles and active conditions (see
  // isLethal). Stored rather than recomputed at render time because
  // StrainCard has neither of those inputs. Undefined until first resolved.
  public lethal?: boolean;

  // Make sure that chromosome pairs in map are correctly deserialized
  @Transform(
    ({ value }) =>
      new Map(
        [...value.entries()].map(([chromName, chromPair]) => [
          chromName,
          ChromosomePair.fromJSON(JSON.stringify(chromPair)),
        ])
      ),
    { toClassOnly: true }
  )
  @Type(() => Map<ChromosomeName | undefined, ChromosomePair>)
  public chromPairMap = new Map<ChromosomeName | undefined, ChromosomePair>();

  constructor(params?: IStrain) {
    // Serialization issue
    if (params === undefined || params === null) return;

    this.name = params.name ?? '';
    this.sex = params.sex ?? Sex.Hermaphrodite;
    this.isParent = params.isParent ?? false;
    this.isChild = params.isChild ?? false;
    this.chromPairMap =
      params.chromPairMap ??
      new Map<ChromosomeName | undefined, ChromosomePair>();

    this.description = params.description;
    this.probability = params.probability ?? 1;
    this.filteredProbability = params.filteredProbability;

    if (params.allelePairs !== undefined && params.chromPairMap === undefined)
      this.addPairsToStrain(params.allelePairs);
    this.genotype =
      params.genotype ?? this.toString({ simplify: true, excludeEca: false });
  }

  public static async build(params: IStrain): Promise<Strain> {
    const strain = new Strain(params);
    await strain.syncFromDb(); // Dynamically query for name
    return strain;
  }

  public static async buildFromChromPairs(
    chromPairs: ChromosomePair[]
  ): Promise<Strain> {
    return await this.build({
      allelePairs: chromPairs
        .filter((chromPair) => !chromPair.isEca() || !chromPair.isWild())
        .flatMap((chromPair) => chromPair.allelePairs),
    });
  }

  public passesFilter(
    filter: StrainFilter,
    parentAlleles: Allele[] = []
  ): boolean {
    const passesAlleleNames =
      filter.alleleNames.size === 0 ||
      [...filter.alleleNames].every((alleleName) =>
        this.getAlleles()
          .map((allele) => allele.getQualifiedName())
          .includes(alleleName)
      );
    const passesReqConds =
      filter.reqConditions.size === 0 ||
      [...filter.reqConditions].every((reqCondName) =>
        this.getReqConditions()
          .map((reqCond) => reqCond.name)
          .includes(reqCondName)
      );
    const passesSupConds =
      filter.supConditions.size === 0 ||
      [...filter.supConditions].every((supCondName) =>
        this.getSupConditions()
          .map((supCond) => supCond.name)
          .includes(supCondName)
      );
    const passesExprPhens =
      filter.exprPhenotypes.size === 0 ||
      [...filter.exprPhenotypes].every((exprPhenName) =>
        this.getExprPhenotypes(parentAlleles, filter.activeConditions)
          .map((exprPhen) => exprPhen.getUniqueName())
          .includes(exprPhenName)
      );

    const passesViability =
      filter.showLethal ||
      !this.isLethal(parentAlleles, filter.activeConditions);

    return (
      passesAlleleNames &&
      passesReqConds &&
      passesSupConds &&
      passesExprPhens &&
      passesViability
    );
  }

  public toggleSex(): Strain {
    const strain = this.clone();
    strain.sex =
      strain.sex === Sex.Hermaphrodite ? Sex.Male : Sex.Hermaphrodite;
    const xChromPair = strain.chromPairMap.get('X');
    if (xChromPair !== undefined)
      strain.chromPairMap.set(
        'X',
        ChromosomePair.buildFromChroms(
          xChromPair.getTop(),
          strain.sex === Sex.Hermaphrodite ? xChromPair.getTop() : undefined
        )
      );
    return strain;
  }

  public isEmptyWild(): boolean {
    const isEmpty = this.chromPairMap.size === 0;
    const isOnlyWildEcas =
      this.chromPairMap.size === 1 &&
      (this.chromPairMap.get('Ex')?.isWild() ?? false);
    return isEmpty || isOnlyWildEcas;
  }

  /** Returns clone with leading het alleles on to and no wild chromosome pairs */
  public simplify(): Strain {
    const clone = this.clone();
    this.chromPairMap.forEach((chromPair, chromName) =>
      clone.chromPairMap.set(chromName, chromPair.simplify())
    );
    return clone;
  }

  private async syncFromDb(): Promise<void> {
    if (this.getNonWildAlleles().length === 0) return undefined;
    const sAFilter: FilterGroup<StrainAlleleFieldName> = {
      filters: [
        this.getNonWildAlleles().map((allele) => [
          'AlleleName',
          { Equal: allele.name },
        ]),
      ],
      orderBy: [],
    };
    const matchCandidates = await Promise.all(
      (await getFilteredStrainAlleles(sAFilter))
        .map(async (sa) => await getStrain(sa.strainName))
        .map(async (strain) => await Strain.createFromRecord(await strain))
    );
    for (const candidate of matchCandidates) {
      if (this.equals(candidate)) {
        this.name = candidate.name;
        this.description = candidate.description;
        break;
      }
    }
  }

  public getSortedChromPairs(): ChromosomePair[] {
    return Array.from(this.chromPairMap.entries())
      .sort((a, b) => cmpChromName(a[0], b[0]))
      .map(([_, chromPair]) => chromPair);
  }

  /**
   * Update genotype string to reflect current genetic contents
   */
  public toString(
    options = {
      simplify: true,
      excludeEca: false,
    }
  ): string {
    const str = this.getSortedChromPairs()
      .filter(
        (chromPair) =>
          !(
            (options.simplify && chromPair.isWild()) ||
            (options.excludeEca && chromPair.isEca())
          )
      )
      .map((chromPair) => chromPair.toString(true))
      .join('; ');
    return str === '' ? 'Wild type' : str + '.';
  }

  static async createFromRecord(record: db_Strain): Promise<Strain> {
    const strainAlleleFilter: FilterGroup<StrainAlleleFieldName> = {
      filters: [[['StrainName', { Equal: record.name }]]],
      orderBy: [],
    };

    const strainAlleles = await getFilteredStrainAlleles(strainAlleleFilter);
    const allelePairs = await Promise.all(
      strainAlleles.map(async (strainAllele) => {
        const allele = await Allele.createFromRecord(
          await getAllele(strainAllele.alleleName)
        );
        return new AllelePair({
          top: strainAllele.isOnTop ? allele : allele.toWild(),
          bot: strainAllele.isOnBot ? allele : allele.toWild(),
        });
      })
    );

    // Merge co-located het pairs
    const hetPairs: AllelePair[] = [];
    const hetMap = new Map<string, AllelePair[]>();
    allelePairs.forEach((allelePair) => {
      const locus =
        allelePair.top.gene?.sysName ?? allelePair.top.variation?.name ?? '';
      hetMap.get(locus)?.push(allelePair) ?? hetMap.set(locus, [allelePair]);
    });
    hetMap.forEach((allelePairs, locus) => {
      if (allelePairs.length > 2)
        throw new Error(
          `Cannot have more than two heterozygous alleles on one gene or variation: ${locus}`
        );
      else if (allelePairs.length === 2) {
        hetPairs.push(allelePairs[0].merge(allelePairs[1]));
      } else hetPairs.push(allelePairs[0]);
    });

    return new Strain({
      name: record.name,
      description: record.description ?? undefined,
      genotype: record.genotype,
      allelePairs: await Promise.all(allelePairs),
    });
  }

  public async save(): Promise<void> {
    if (this.name === undefined)
      throw new Error('Tried to save strain without name.');
    await insertStrain(this);
    await this.insertAllelePairs();
  }

  /**
   * Updates an already-saved strain, identified by its previous name (which
   * may differ from `this.name` if the strain is being renamed). Fully
   * replaces the strain's `strain_alleles` rows with whatever `this` strain
   * currently represents, rather than diffing/patching them.
   */
  public async update(oldName: string): Promise<void> {
    if (this.name === undefined)
      throw new Error('Tried to update strain without name.');
    await updateStrain(oldName, this.generateRecord());
    // strain_alleles.strain_name has ON UPDATE CASCADE, so a rename above
    // already moved any existing rows from oldName to this.name - delete by
    // the current name (a no-op rename leaves oldName === this.name).
    await deleteFilteredStrainAlleles({
      filters: [[['StrainName', { Equal: this.name }]]],
      orderBy: [],
    });
    await this.insertAllelePairs();
  }

  private async insertAllelePairs(): Promise<void> {
    const simplified = this.simplify();
    const inserts = simplified.getAllelePairs().flatMap((pair) => {
      if (pair.isHomo()) {
        return [
          insertDbStrainAllele({
            strainName: this.name ?? '',
            alleleName: pair.top.name,
            isOnTop: true,
            isOnBot: true,
          }),
        ];
      }
      const pairInserts = [];
      if (!pair.top.isWild()) {
        pairInserts.push(
          insertDbStrainAllele({
            strainName: this.name ?? '',
            alleleName: pair.top.name,
            isOnTop: true,
            isOnBot: false,
          })
        );
      }
      if (!pair.bot.isWild()) {
        pairInserts.push(
          insertDbStrainAllele({
            strainName: this.name ?? '',
            alleleName: pair.bot.name,
            isOnTop: false,
            isOnBot: true,
          })
        );
      }
      return pairInserts;
    });
    await Promise.all(inserts);
  }

  public toMale(): Strain {
    const male = this.clone();
    male.sex = Sex.Male;
    return male;
  }

  public toHerm(): Strain {
    const herm = this.clone();
    herm.sex = Sex.Hermaphrodite;
    return herm;
  }

  /* "Regular" alleles are homozygous, X chrom in males, or extrachromosomal array */
  public getRegularAlleles(sex: Sex): Allele[] {
    return [
      ...this.getHomoAlleles(),
      ...this.getEcaAlleles(),
      ...this.getHetAlleles().filter(
        (hetAllele) => hetAllele.isX() && sex === Sex.Male
      ),
    ];
  }

  /* "Iregular" alleles heterozygous (not just in our representation, but in biological reality) */
  public getIrregularAlleles(sex: Sex): Allele[] {
    return [
      ...this.getHetAlleles().filter(
        (hetAllele) => !hetAllele.isX() || sex === Sex.Hermaphrodite
      ),
    ];
  }

  public getHomoAlleles(): Allele[] {
    return this.getAllelePairs()
      .filter((allelePair) => !allelePair.isEca() && allelePair.isHomo())
      .map((allelePair) => allelePair.top);
  }

  public getHetAlleles(): Allele[] {
    return this.getAllelePairs()
      .filter((allelePair) => !allelePair.isEca() && !allelePair.isHomo())
      .map((allelePair) => [allelePair.top, allelePair.bot])
      .flat()
      .filter((allele) => !allele.isWild());
  }

  public getEcaAlleles(): Allele[] {
    return this.getAllelePairs()
      .filter((allelePair) => allelePair.isEca())
      .map((allelePair) => allelePair.top);
  }

  /**
   * Checks if both strains represent the same genetic profile (ignoring explicitly represented wilds)
   * @param other strain to compare against
   */
  public equals(other: Strain, excludeEca = false): boolean {
    const nonWildChromNames = Array.from(this.chromPairMap.entries())
      .filter(
        ([_, chromPair]) =>
          !(chromPair.isWild() || (excludeEca && chromPair.isEca()))
      )
      .map(([chromName, _]) => chromName);
    const otherNonWildChromNames = Array.from(other.chromPairMap.entries())
      .filter(
        ([_, chromPair]) =>
          !(chromPair.isWild() || (excludeEca && chromPair.isEca()))
      )
      .map(([chromName, _]) => chromName);
    if (nonWildChromNames.length !== otherNonWildChromNames.length)
      return false;

    let allPairsMatch = true;
    nonWildChromNames.forEach((chromName) => {
      const chromPair = this.chromPairMap.get(chromName);
      const otherChromPair = other.chromPairMap.get(chromName);

      if (chromPair === undefined || otherChromPair === undefined) {
        allPairsMatch = false;
      } else if (!chromPair.equals(otherChromPair)) allPairsMatch = false;
    });

    return allPairsMatch;
  }

  /**
   * Returns a new strain with identical data to this
   */
  public clone(): Strain {
    return new Strain({
      ...this,
      chromPairMap: new Map(this.chromPairMap),
    });
  }

  /**
   * Crosses this strain with itself
   * @returns Permuted list of all possible strains and their respective probabilities
   */
  public async selfCross(): Promise<Strain[]> {
    return await this.crossWith(this);
  }

  /**
   * Crosses this strain with {other}
   * @param other strain to cross against
   * @returns Permuted list of all possible strains and their respective probabilities
   */
  public async crossWith(other: Strain): Promise<Strain[]> {
    this.fillWildsFrom(other);
    other.fillWildsFrom(this);

    const gametes1 = this.meiosis();
    const gametes2 = other.meiosis();
    const exOptions = ChromosomePair.crossEx(
      this.chromPairMap.get('Ex'),
      other.chromPairMap.get('Ex')
    );
    return await Strain.fertilize(gametes1, gametes2, exOptions);
  }

  public getAllelePairs(): AllelePair[] {
    return [...this.chromPairMap.values()]
      .map((pair) => pair.allelePairs)
      .flat();
  }

  public static async fertilize(
    gametes1: Gamete[],
    gametes2: Gamete[] = gametes1,
    exOptions: ChromosomePairOption[] = [
      { pair: new ChromosomePair([]), prob: 1 },
    ]
  ): Promise<Strain[]> {
    const strains = await Promise.all(
      gametes1.flatMap((gamete1) =>
        gametes2.flatMap((gamete2) =>
          exOptions.map(async (exOption) => {
            const chromPairs = gamete1.chromosomes.map((chrom, idx) =>
              ChromosomePair.buildFromChroms(chrom, gamete2.chromosomes[idx])
            );
            chromPairs.push(exOption.pair);
            const strain = await Strain.buildFromChromPairs(chromPairs);
            strain.probability = gamete1.prob * gamete2.prob * exOption.prob;
            strain.isChild = true;
            return strain;
          })
        )
      )
    );
    Strain.reduceStrains(strains);
    strains.sort((a, b) => (b?.probability ?? 0) - (a?.probability ?? 0));
    return strains;
  }

  /**
   * Produce all distinct "gametes", meaning top-heterozygous strains
   * representing eggs/sperm. Excludes the `'Ex'` pseudo-chromosome (filtered
   * by map key, not `chromPair.isEca()`, which can read false for an empty/
   * all-wild Ex pair) - extrachromosomal arrays have no genetic location for
   * recombination math to act on, and are instead resolved independently at
   * fertilization via `ChromosomePair.crossEx()`.
   */
  public meiosis(): Gamete[] {
    return Array.from(this.chromPairMap.entries())
      .filter(([chromName]) => chromName !== 'Ex')
      .sort((a, b) => cmpChromName(a[0], b[0]))
      .map(([, pair]) => pair.meiosis())
      .reduce<ChromosomeOption[][]>(
        // Cartesian product
        (a, b) => a.flatMap((d) => b.map((e) => [d, e].flat())),
        [[]]
      )
      .map((gameteChromOpts) => {
        return {
          chromosomes: gameteChromOpts.map(
            (gameteChromOpt) => gameteChromOpt.chromosome
          ),
          prob: gameteChromOpts.reduce(
            (prob, gameteChromOpt) => prob * gameteChromOpt.prob,
            1
          ),
        };
      });
  }

  public getAlleleExpressions(): AlleleExpression[] {
    return this.getNonWildAlleles().flatMap(
      (allele) => allele.alleleExpressions
    );
  }

  public getNonWildAlleles(): Allele[] {
    return this.getAlleles().filter((allele) => !allele.isWild());
  }

  public getAlleles(): Allele[] {
    return this.getAllelePairs()
      .map((pair) => [pair.top, pair.bot])
      .flat();
  }

  /**
   * Copies of `alleleName` this genotype carries - '0' (absent, wild-type
   * homozygous), '1' (heterozygous), or '2' (homozygous mutant). A male's
   * single hemizygous X-linked copy counts as '2', not '1' - there's no
   * wild-type copy to mask it, so it behaves like a fully-expressed
   * homozygote, not a heterozygote. A trans-heterozygous pair of two
   * *different* non-wild alleles (e.g. a compound-het `ed3/n765`) counts as
   * '1' copy of each - this only evaluates a single named allele in
   * isolation, so it can't see that the pair might jointly satisfy a
   * gene-level "2 copies (lof)" row (`Zygosity` `'5'`); that's handled
   * separately by `isGeneLofSatisfied`.
   */
  public getZygosity(alleleName: string): '0' | '1' | '2' {
    const pair = this.getAllelePairs().find(
      (p) => p.top.name === alleleName || p.bot.name === alleleName
    );
    if (pair === undefined) return '0';
    if (pair.isHomo()) return pair.isWild() ? '0' : '2';
    if (pair.isWildHet()) {
      const mutantAllele = pair.top.isWild() ? pair.bot : pair.top;
      if (this.sex === Sex.Male && mutantAllele.isX()) return '2';
      return '1';
    }
    return '1';
  }

  /**
   * Whether `expr` (a `Zygosity` `'5'`, "2 copies (lof)" row) is satisfied:
   * this genotype has 2 mutant copies of `expr`'s gene, whether that's the
   * same allele twice or 2 different alleles of the gene in trans - as
   * long as the trans partner independently carries its own `'5'` row for
   * this exact phenotype (same-phenotype complementation-group match,
   * confirmed as a requirement - a gene can have unrelated phenotypes that
   * don't necessarily fail to complement with each other).
   */
  private isGeneLofSatisfied(expr: AlleleExpression): boolean {
    const pair = this.getAllelePairs().find(
      (p) => p.top.name === expr.alleleName || p.bot.name === expr.alleleName
    );
    if (pair === undefined) return false;
    if (pair.isHomo()) return !pair.isWild();
    const otherSide = pair.top.name === expr.alleleName ? pair.bot : pair.top;
    if (otherSide.isWild()) return false;
    const key = expr.expressingPhenotype.getUniqueName();
    return otherSide.alleleExpressions.some(
      (otherExpr) =>
        otherExpr.dominance === '5' &&
        otherExpr.expressingPhenotype.getUniqueName() === key
    );
  }

  /**
   * Resolves which phenotypes this genotype actually expresses - backlog
   * #11's second half. For every `AlleleExpression` row on every allele
   * this genotype or its direct parent(s) carry (`parentAlleles` - not a
   * full ancestor walk, just the one/two immediate inputs to the cross that
   * produced this genotype, which is what makes a `'0'`-copy/wild-type-
   * background row reachable at all for an allele this genotype itself
   * doesn't carry), a row's phenotype is expressed when:
   * 1. This genotype's zygosity at that allele matches the row's declared
   *    zygosity (`'1or2'` matches either heterozygous or homozygous).
   * 2. It isn't suppressed by a currently-active condition, and doesn't
   *    require one that's inactive.
   * 3. It isn't suppressed by another expressed phenotype, and doesn't
   *    require one that isn't expressed.
   *
   * Rule 3 can chain to arbitrary depth, and a phenotype's status must be
   * three-valued while resolving - true, established-false, or still
   * unknown - because "not yet known to be expressed" is not the same as
   * "established not expressed": a row may only rely on a suppressing
   * phenotype being *established* false, never on it merely being
   * undecided so far, or the result becomes dependent on resolution order.
   * Each round computes every still-unknown phenotype's next status purely
   * from a snapshot of the previous round (never from values just decided
   * earlier in the same round), so the outcome never depends on allele or
   * row iteration order. Phenotypes that stay unknown once a full round
   * produces no change are a genuine circular/unsatisfiable dependency
   * (e.g. A requires B, B is suppressed by A) - see
   * `getUnresolvedExprPhenotypes()`.
   */
  public getExprPhenotypes(
    parentAlleles: Allele[] = [],
    activeConditions = new Set<string>()
  ): Phenotype[] {
    return this.resolveExprPhenotypes(parentAlleles, activeConditions)
      .expressed;
  }

  /**
   * Phenotypes whose expression could not be established either way -
   * see `getExprPhenotypes()`. Always empty unless the underlying
   * phenotype-conditional data has a genuine circular dependency.
   */
  public getUnresolvedExprPhenotypes(
    parentAlleles: Allele[] = [],
    activeConditions = new Set<string>()
  ): Phenotype[] {
    return this.resolveExprPhenotypes(parentAlleles, activeConditions)
      .unresolved;
  }

  private resolveExprPhenotypes(
    parentAlleles: Allele[],
    activeConditions: Set<string>
  ): { expressed: Phenotype[]; unresolved: Phenotype[] } {
    type Status = 'true' | 'false' | 'unknown';

    const trackedAlleles = new Map<string, Allele>();
    [...this.getNonWildAlleles(), ...parentAlleles].forEach((allele) => {
      if (!trackedAlleles.has(allele.name)) {
        trackedAlleles.set(allele.name, allele);
      }
    });
    const allTrackedExprs = [...trackedAlleles.values()].flatMap(
      (allele) => allele.alleleExpressions
    );
    const candidateExprs = allTrackedExprs.filter((expr) => {
      let zygosityMatches: boolean;
      if (expr.dominance === '5') {
        zygosityMatches = this.isGeneLofSatisfied(expr);
      } else {
        const actualZygosity = this.getZygosity(expr.alleleName);
        zygosityMatches =
          expr.dominance === '1or2'
            ? actualZygosity === '1' || actualZygosity === '2'
            : expr.dominance === actualZygosity;
      }
      if (!zygosityMatches) return false;
      if (
        expr.suppressingConditions.some((cond) =>
          activeConditions.has(cond.name)
        )
      ) {
        return false;
      }
      if (
        expr.requiredConditions.some((cond) => !activeConditions.has(cond.name))
      ) {
        return false;
      }
      return true;
    });

    const exprsByKey = new Map<string, AlleleExpression[]>();
    const keyToPhenotype = new Map<string, Phenotype>();
    candidateExprs.forEach((expr) => {
      const key = expr.expressingPhenotype.getUniqueName();
      keyToPhenotype.set(key, expr.expressingPhenotype);
      const rows = exprsByKey.get(key) ?? [];
      rows.push(expr);
      exprsByKey.set(key, rows);
    });

    // A phenotype referenced as a conditional but with no candidate row of
    // its own can never become expressed here, so it starts (and stays)
    // established false - not unknown.
    const status = new Map<string, Status>();
    candidateExprs.forEach((expr) => {
      [...expr.requiredPhenotypes, ...expr.suppressingPhenotypes].forEach(
        (phen) => {
          const key = phen.getUniqueName();
          if (!status.has(key)) {
            status.set(key, exprsByKey.has(key) ? 'unknown' : 'false');
          }
        }
      );
    });
    exprsByKey.forEach((_rows, key) => {
      if (!status.has(key)) status.set(key, 'unknown');
    });

    const computeRowStatus = (
      expr: AlleleExpression,
      snapshot: Map<string, Status>
    ): Status => {
      const reqStatuses = expr.requiredPhenotypes.map(
        (phen) => snapshot.get(phen.getUniqueName()) ?? 'false'
      );
      const supStatuses = expr.suppressingPhenotypes.map(
        (phen) => snapshot.get(phen.getUniqueName()) ?? 'false'
      );
      if (reqStatuses.some((s) => s === 'false')) return 'false';
      if (supStatuses.some((s) => s === 'true')) return 'false';
      if (
        reqStatuses.every((s) => s === 'true') &&
        supStatuses.every((s) => s === 'false')
      ) {
        return 'true';
      }
      return 'unknown';
    };

    let changed = true;
    while (changed) {
      changed = false;
      const snapshot = new Map(status);
      status.forEach((currStatus, key) => {
        if (currStatus !== 'unknown') return;
        const rows = exprsByKey.get(key) ?? [];
        const rowStatuses = rows.map((row) => computeRowStatus(row, snapshot));
        let nextStatus: Status = 'unknown';
        if (rowStatuses.some((s) => s === 'true')) nextStatus = 'true';
        else if (rowStatuses.every((s) => s === 'false')) nextStatus = 'false';
        if (nextStatus !== 'unknown') {
          status.set(key, nextStatus);
          changed = true;
        }
      });
    }

    const expressed: Phenotype[] = [];
    const unresolved: Phenotype[] = [];
    exprsByKey.forEach((_rows, key) => {
      const phen = keyToPhenotype.get(key);
      if (phen === undefined) return;
      if (status.get(key) === 'true') expressed.push(phen);
      else if (status.get(key) === 'unknown') unresolved.push(phen);
    });

    // Wild-type-background default: an allele's expression data models the
    // mutant side of a phenotype (and conditions/relations that alter it),
    // not a companion "0 copies" wild-type row for every case - there's no
    // Basic-tab control that even produces one. So for every phenotype name
    // this genotype's tracked alleles have an opinion about, if there's no
    // row anywhere declaring that name's wild-type phenotype at all, and the
    // mutant side didn't cleanly resolve true, the wild-type phenotype is
    // the implicit default. This only fills a genuine data gap - it never
    // overrides a wild-type row that already exists and simply resolved
    // false on its own merits (e.g. blocked by an inactive condition), and
    // it never overrides a still-genuinely-unknown (circular) case, which
    // stays surfaced via `unresolved` instead of being silently guessed.
    const namesWithWildRow = new Set(
      allTrackedExprs
        .filter((expr) => expr.expressingPhenotype.wild)
        .map((expr) => expr.expressingPhenotype.name)
    );
    const phenotypeNames = new Set(
      allTrackedExprs.map((expr) => expr.expressingPhenotype.name)
    );
    phenotypeNames.forEach((name) => {
      if (namesWithWildRow.has(name)) return;
      const mutantStatus = status.get(name) ?? 'false';
      if (mutantStatus === 'true' || mutantStatus === 'unknown') return;
      expressed.push(new Phenotype({ name, shortName: name, wild: true }));
    });

    return { expressed, unresolved };
  }

  public getReqConditions(): Condition[] {
    const allReqConditions = this.getAlleleExpressions().flatMap(
      (expr) => expr.requiredConditions
    );
    return allReqConditions.reduce<Condition[]>((prev, curr) => {
      if (!prev.map((cond) => cond.name).includes(curr.name)) prev.push(curr);
      return prev;
    }, []);
  }

  public getSupConditions(): Condition[] {
    const allSupConditions = this.getAlleleExpressions().flatMap(
      (expr) => expr.suppressingConditions
    );
    return allSupConditions.reduce<Condition[]>((prev, curr) => {
      if (!prev.map((cond) => cond.name).includes(curr.name)) prev.push(curr);
      return prev;
    }, []);
  }

  public getMaturationDays(
    parentAlleles: Allele[] = [],
    activeConditions = new Set<string>()
  ): number {
    const maturationDays = [
      ...this.getExprPhenotypes(parentAlleles, activeConditions),
    ].flatMap((phen) => phen.maturationDays ?? []);
    if (maturationDays.length === 0) maturationDays.push(3); // default

    return Math.max(...maturationDays);
  }

  /** True if any currently-expressed phenotype is flagged lethal. */
  public isLethal(
    parentAlleles: Allele[] = [],
    activeConditions = new Set<string>()
  ): boolean {
    return this.getExprPhenotypes(parentAlleles, activeConditions).some(
      (phen) => phen.lethal === true
    );
  }

  /**
   * Populates {this} with any missing alleles from {other} (represented as wild strains)
   * @param other Strain to compare against and look for any missing alleles
   */
  public fillWildsFrom(other: Strain): void {
    other.chromPairMap.forEach((otherChromPair, chromName) => {
      const chromPair =
        this.chromPairMap.get(chromName) ?? new ChromosomePair([]);

      // Add chromosome to strain, if missing
      if (!this.chromPairMap.has(chromName)) {
        this.chromPairMap.set(chromName, chromPair);
      }

      chromPair.fillWildsFrom(otherChromPair);
    });
  }

  /**
   * Adds a provided AllelePair to this strain. Throws an error if this fails (pair already exists).
   */
  private addPairToStrain(allelePair: AllelePair): void {
    const chromName = allelePair.top.getChromName();
    let chromPair = this.chromPairMap.get(chromName);
    if (chromPair === undefined) {
      chromPair = new ChromosomePair([]);
      this.chromPairMap.set(chromName, chromPair);
    }

    // Prevent homozygous X alleles for males (only one X chromosome)
    if (
      this.sex === Sex.Male &&
      chromPair.isX() &&
      !allelePair.top.isWild() &&
      allelePair.isWildHet()
    ) {
      throw new Error(
        `Cannot add allele pair ${allelePair} because it is on the X chromosome, and males have only one X chromosome`
      );
    }

    // Prevent duplicated genes
    if (chromPair.containsSameGeneOrVariationAs(allelePair)) {
      throw new Error(
        `Cannot add allele pair ${allelePair} because it conflicts with of the same gene or variation.`
      );
    }

    chromPair.insertPair(allelePair);
  }

  /**
   * Combines probabilities of duplicate Strains such that the resulting list has unique strains
   */
  private static reduceStrains(strains: Strain[]): void {
    // Check each strain against every other strain
    for (let i = 0; i < strains.length; i++) {
      const currStrain = strains[i];

      // Check for duplicates and combine probabilities
      for (let j = i + 1; j < strains.length; ) {
        const strain = strains[j];
        const duplicate = currStrain.equals(strain);

        if (duplicate) {
          currStrain.probability =
            (currStrain.probability ?? 0) + strain.probability;
          strains.splice(j, 1);
        } else {
          j++;
        }
      }
    }
  }

  private addPairsToStrain(pairs: AllelePair[]): void {
    pairs.forEach((pair) => {
      this.addPairToStrain(pair);
    });
  }

  public toJSON(): string {
    return JSON.stringify(instanceToPlain(this));
  }

  static fromJSON(json: string): Strain {
    return plainToInstance(Strain, JSON.parse(json) as Record<string, unknown>);
  }

  @Exclude()
  generateRecord(): db_Strain {
    return {
      name: this.name ?? '',
      genotype: this.genotype,
      description: this.description ?? null,
    };
  }
}

export function cmpChromName(
  chromA?: ChromosomeName,
  chromB?: ChromosomeName
): number {
  if (chromA === undefined) {
    return 1;
  } else if (chromB === undefined) {
    return -1;
  } else {
    const posA = chromosomes.indexOf(chromA);
    const posB = chromosomes.indexOf(chromB);
    return posA - posB;
  }
}
