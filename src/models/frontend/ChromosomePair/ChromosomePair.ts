import { AllelePair } from 'models/frontend/AllelePair/AllelePair';
import { type Allele } from 'models/frontend/Allele/Allele';
import { type ChromosomeName } from 'models/db/filter/db_ChromosomeName';
import { Type, instanceToPlain, plainToInstance } from 'class-transformer';

export interface ChromosomeOption {
  chromosome: Allele[];
  prob: number;
}

/**
 * Two homologous chromosomes of a specimen, represented as an array of allele pairs
 * kept in sorted order by genetic position. Also extrachromosomal array - Ex pairs
 * are crossed via `crossEx()`, not `meiosis()` (which must never be called on the
 * `'Ex'` pseudo-chromosome; see `Strain.meiosis()`).
 */
export class ChromosomePair {
  @Type(() => AllelePair)
  public allelePairs: AllelePair[] = [];

  constructor(allelePairs: AllelePair[]) {
    if (allelePairs !== undefined) {
      if (!ChromosomePair.areOnSameChrom(allelePairs))
        throw new Error('Allele pairs on different chromosomes.');
      AllelePair.sort(allelePairs);
      this.allelePairs = allelePairs;
    }
  }

  private static areOnSameChrom(allelePairs: AllelePair[]): boolean {
    if (allelePairs.length === 0) return true;
    const chromName = allelePairs[0].getChromName();
    return allelePairs.every(
      (allelePair) => allelePair.getChromName() === chromName
    );
  }

  public static buildFromChroms(top: Allele[], bot?: Allele[]): ChromosomePair {
    if (top.length > 0 && top[0].isEca()) {
      return ChromosomePair.ecaBuildFromChroms(top, bot);
    }
    return new ChromosomePair(
      top.map(
        (topAllele, idx) =>
          new AllelePair({
            top: topAllele,
            bot: bot?.[idx] ?? topAllele.toWild(),
          })
      )
    );
  }

  private static ecaBuildFromChroms(
    top: Allele[],
    bot: Allele[] = []
  ): ChromosomePair {
    const uniqueNonWild = [...top, ...bot].reduce<Allele[]>((unique, curr) => {
      if (!unique.some((allele) => allele.equals(curr)) && !curr.isWild())
        unique.push(curr);
      return unique;
    }, []);
    return new ChromosomePair(
      uniqueNonWild
        .sort((a, b) => (a.name < b.name ? -1 : 1))
        .map((allele) => new AllelePair({ top: allele, bot: allele.toWild() }))
    );
  }

  /** Return a new, equivalent chromosome pair without any wild allele pairs */
  public simplify(): ChromosomePair {
    const allelePairs = this.allelePairs.filter(
      (allelePair) => !allelePair.isWild()
    );
    if (allelePairs.length > 0 && allelePairs[0].top.isWild())
      allelePairs.forEach((allelePair) => {
        allelePair.flip();
      });
    return new ChromosomePair(allelePairs);
  }

  public getChromName(): ChromosomeName | undefined {
    return this.allelePairs.at(0)?.top.getChromName();
  }

  public containsSameGeneOrVariationAs(otherPair: AllelePair): boolean {
    return this.allelePairs.some((pair) =>
      pair.isOfSameGeneOrVariation(otherPair)
    );
  }

  public toString(simplify = false): string {
    const chromName = this.getChromName();
    const chromPair = simplify ? this.simplify() : this;
    if (this.isHomo()) {
      return (
        chromPair.allelePairs
          .map((pair) => pair.top.getQualifiedName())
          .join(' ') +
        ' ' +
        (chromName ?? '?')
      );
    } else {
      const top = ChromosomePair.getChromosomeString(chromPair.getTop());
      const bot = ChromosomePair.getChromosomeString(chromPair.getBot());
      return top + '/' + bot + ' ' + (chromName ?? '?');
    }
  }

  public clone(): ChromosomePair {
    return new ChromosomePair(this.allelePairs.map((pair) => pair.clone()));
  }

  public getTop(): Allele[] {
    return this.allelePairs.map((pair) => pair.top);
  }

  public getBot(): Allele[] {
    return this.allelePairs.map((pair) => pair.bot);
  }

  public isWild(): boolean {
    return this.allelePairs.every((pair) => pair.isWild());
  }

  public isHomo(): boolean {
    return this.allelePairs.every((pair) => pair.isHomo());
  }

  public isWildHet(): boolean {
    return (
      !this.isHomo() &&
      (this.getTop().every((allele) => allele.isWild()) ||
        this.getBot().every((allele) => allele.isWild()))
    );
  }

  public isEca(): boolean {
    return this.getChromName() === 'Ex';
  }

  public isX(): boolean {
    return this.getChromName() === 'X';
  }

  private static getChromosomeString(chrom: Allele[]): string {
    return chrom
      .map((allele) => {
        return allele.isWild() ? allele.name : allele.getQualifiedName();
      })
      .join(' ');
  }

  public equals(other: ChromosomePair): boolean {
    function chromsEqual(chrom1: Allele[], chrom2: Allele[]): boolean {
      const chrom1NoWilds = chrom1.filter((allele) => !allele.isWild());
      const chrom2NoWilds = chrom2.filter((allele) => !allele.isWild());

      return (
        chrom1NoWilds.length === chrom2NoWilds.length &&
        chrom1NoWilds.every((allele, idx) => allele.equals(chrom2NoWilds[idx]))
      );
    }

    const sameSidesEqual =
      chromsEqual(this.getTop(), other.getTop()) &&
      chromsEqual(this.getBot(), other.getBot());
    const flippedSidesEqual =
      chromsEqual(this.getTop(), other.getBot()) &&
      chromsEqual(this.getBot(), other.getTop());
    return sameSidesEqual || flippedSidesEqual;
  }

  /**
   * Computes the possible combinations (for a single chromosome) that can result due to genetic recombination
   * @param startingChrom Alleles used before a recombination event
   * @param flippedChrom Alleles used after a recombination event
   * @param chromPair List of allele pairs that represent the combined starting/flipped sides
   * @returns list of allele chains and their respective probabilities
   */
  private static permuteRecombOptions(
    startingChrom: Allele[],
    flippedChrom: Allele[],
    chromPair: AllelePair[],
    suppressors: Array<[number, number]>
  ): ChromosomeOption[] {
    const chroms: ChromosomeOption[] = [];

    // first iteration accounts for NO recombination at all
    for (let i = 0; i < chromPair.length; i++) {
      let chrom: Allele[] = [];
      let probability = 0.5;
      chrom.push(startingChrom[0]);

      for (let j = 1; j < chromPair.length; j++) {
        const recombinationProb = this.getRecombProb(
          chromPair[j - 1],
          chromPair[j],
          suppressors
        );

        // recombination event
        if (j === i) {
          chrom = chrom.concat(flippedChrom.slice(j)); // add remainder of alleles of other chrom
          probability = recombinationProb;
          break;
        }

        // no recombination, continue along starting side
        probability -= recombinationProb;
        chrom.push(startingChrom[j]);
      }
      chroms.push({
        chromosome: chrom,
        prob: probability,
      });
    }

    return chroms;
  }

  /**
   * @returns absolute value of the genetic difference of 2 allele pairs (or 0
   * if a pair doesn't have a genetic location), reduced by how much of the
   * gap between them a heterozygous balancer covers (see `uncoveredFraction`)
   */
  private static getRecombProb(
    pair1: AllelePair,
    pair2: AllelePair,
    suppressors: Array<[number, number]> = []
  ): number {
    const genPos1 = pair1.top.getGenPosition();
    const genPos2 = pair2.top.getGenPosition();
    if (genPos1 === undefined || genPos2 === undefined) return 0;

    const halfDistance = Math.abs(genPos1 - genPos2) / 2;
    const baseProb = halfDistance / 100; // convert to decimal form
    return (
      baseProb *
      ChromosomePair.uncoveredFraction(
        pair1.top.getPhysPosition(),
        pair2.top.getPhysPosition(),
        suppressors
      )
    );
  }

  /**
   * The physical ranges (bp) in which crossovers are currently suppressed on
   * this chromosome: those of every balancer carried by only ONE homologue.
   * A homozygous balancer suppresses nothing (crossovers between two balancer
   * homologues are allowed), and a wild copy never counts as a balancer even
   * though it keeps its variation. Overlapping ranges are merged so a stretch
   * is never counted twice.
   */
  public getActiveSuppressors(): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    this.allelePairs.forEach((pair) => {
      if (pair.isHomo()) return;
      [pair.top, pair.bot].forEach((allele) => {
        const range = allele.variation?.recombination;
        if (range !== undefined && !allele.isWild())
          ranges.push([Math.min(...range), Math.max(...range)]);
      });
    });

    ranges.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    ranges.forEach(([start, end]) => {
      const last = merged.at(-1);
      if (last !== undefined && start <= last[1])
        last[1] = Math.max(last[1], end);
      else merged.push([start, end]);
    });
    return merged;
  }

  /**
   * The share (0-1) of the physical gap between two loci that is NOT inside a
   * suppressed range, by which the crossover probability of that gap is
   * scaled: fully inside a range = 0, fully outside = 1, straddling an edge =
   * in between. A rough approximation - genetic and physical distance are not
   * proportional - but it avoids a cliff at the balancer's breakpoints. If
   * either locus has no physical position, nothing is suppressed.
   */
  private static uncoveredFraction(
    physPos1: number | undefined,
    physPos2: number | undefined,
    suppressors: Array<[number, number]>
  ): number {
    if (suppressors.length === 0) return 1;
    if (physPos1 === undefined || physPos2 === undefined) return 1;

    const low = Math.min(physPos1, physPos2);
    const high = Math.max(physPos1, physPos2);
    if (low === high)
      return suppressors.some(([start, end]) => start <= low && low <= end)
        ? 0
        : 1;

    const covered = suppressors.reduce(
      (sum, [start, end]) =>
        sum + Math.max(0, Math.min(high, end) - Math.max(low, start)),
      0
    );
    return 1 - covered / (high - low);
  }

  /**
   * Permutes all of the possible chroms due to a recombination event (or no recombination event)
   * @param chromosome All allele pairs belonging to a strain's chromosomes
   */
  public meiosis(): ChromosomeOption[] {
    const topAlleles = this.getTop();
    const botAlleles = this.getBot();

    const suppressors = this.getActiveSuppressors();

    // Permute possible recombinations starting on both top and bottom
    const topRecombOptions = ChromosomePair.permuteRecombOptions(
      topAlleles,
      botAlleles,
      this.allelePairs,
      suppressors
    );

    const botRecombOptions = ChromosomePair.permuteRecombOptions(
      botAlleles,
      topAlleles,
      this.allelePairs,
      suppressors
    );

    const totalRecombOptions = topRecombOptions.concat(botRecombOptions);
    ChromosomePair.reduceChromOptions(totalRecombOptions);

    return totalRecombOptions;
  }

  public fillWildsFrom(other: ChromosomePair): void {
    other.allelePairs.forEach((otherAllelePair) => {
      const alreadyHasAllele = this.allelePairs.some((pair) =>
        pair.isOfSameGeneOrVariation(otherAllelePair)
      );

      // Add wild pair to pair list to match other strain
      if (!alreadyHasAllele) this.insertWildOfPair(otherAllelePair);
    });
  }

  /**
   * Inserts a wild pair into {this} based on the genetic location of {otherPair}
   * @param otherPair Pair from other strain that will be represented as wild pair
   */
  private insertWildOfPair(otherPair: AllelePair): void {
    this.insertPair(
      new AllelePair({
        top: otherPair.top.toWild(),
        bot: otherPair.top.toWild(),
      })
    );
  }

  public insertPair(pair: AllelePair): void {
    this.allelePairs.push(pair);
    AllelePair.sort(this.allelePairs);
  }

  /**
   * Every distinct Ex array carried by either parent is transmitted to an
   * offspring as its own independent event, with probability
   * `allele.getTransmissionProb()` - not linked/correlated segregation the
   * way a real chromosome's `meiosis()` would model it (Ex arrays have no
   * genetic location, so there's nothing for recombination math to act on).
   * A given array is counted once even if both parents carry it - it's the
   * same array, not two independent copies.
   */
  public static crossEx(
    leftChromPair: ChromosomePair | undefined,
    rightChromPair: ChromosomePair | undefined
  ): ChromosomePairOption[] {
    const alleles = ChromosomePair.collectUniqueEcaAlleles([
      leftChromPair,
      rightChromPair,
    ]);

    let options: Array<{ alleles: Allele[]; prob: number }> = [
      { alleles: [], prob: 1 },
    ];
    for (const allele of alleles) {
      const transmissionProb = allele.getTransmissionProb();
      const next: Array<{ alleles: Allele[]; prob: number }> = [];
      if (transmissionProb > 0) {
        next.push(
          ...options.map((opt) => ({
            alleles: [...opt.alleles, allele],
            prob: opt.prob * transmissionProb,
          }))
        );
      }
      if (transmissionProb < 1) {
        next.push(
          ...options.map((opt) => ({
            alleles: opt.alleles,
            prob: opt.prob * (1 - transmissionProb),
          }))
        );
      }
      options = next;
    }

    return options.map((option) => ({
      pair: new ChromosomePair(
        option.alleles.map((allele) => allele.toTopHet())
      ),
      prob: option.prob,
    }));
  }

  /**
   * Non-wild Ex alleles from both chromosome pairs, deduped by allele name
   * (the same array present in both parents must count once, not twice)
   * and sorted by name for deterministic output order.
   */
  private static collectUniqueEcaAlleles(
    chromPairs: Array<ChromosomePair | undefined>
  ): Allele[] {
    const alleles = chromPairs
      .flatMap((chromPair) => chromPair?.allelePairs ?? [])
      .filter((allelePair) => !allelePair.isWild())
      .map((allelePair) =>
        allelePair.top.isWild() ? allelePair.bot : allelePair.top
      );

    const unique: Allele[] = [];
    for (const allele of alleles) {
      if (!unique.some((existing) => existing.equals(allele)))
        unique.push(allele);
    }
    return unique.sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  /**
   * Combines probabilities of duplicate chroms such that the resulting list has unique chroms
   */
  public static reduceChromOptions(chromOpts: ChromosomeOption[]): void {
    // Check each option against every other option
    for (let i = 0; i < chromOpts.length; i++) {
      const currChromOpt = chromOpts[i];

      // Check for duplicates and combine probabilities
      for (let j = i + 1; j < chromOpts.length; ) {
        const nextChromOpt = chromOpts[j];
        const duplicateChromosomes: boolean = chromsEqual(
          currChromOpt.chromosome,
          nextChromOpt.chromosome
        );

        if (duplicateChromosomes) {
          currChromOpt.prob += nextChromOpt.prob;
          chromOpts.splice(j, 1);
        } else {
          j++;
        }
      }
    }
  }

  public toJSON(): string {
    return JSON.stringify(instanceToPlain(this));
  }

  static fromJSON(json: string): ChromosomePair {
    return plainToInstance(
      ChromosomePair,
      JSON.parse(json) as Record<string, unknown>
    );
  }
}

export const chromsEqual = (chromA: Allele[], chromB: Allele[]): boolean => {
  if (chromA.length !== chromB.length) return false;
  return chromA.every((allele, idx) => allele.equals(chromB[idx]));
};

export interface ChromosomePairOption {
  pair: ChromosomePair;
  prob: number;
}
