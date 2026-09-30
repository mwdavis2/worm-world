import { getAlteringConditions } from 'api/condition';
import { getAlteringPhenotypes, getPhenotype } from 'api/phenotype';
import {
  Exclude,
  Type,
  instanceToPlain,
  plainToInstance,
} from 'class-transformer';
import { type db_AlleleExpression } from 'models/db/db_AlleleExpression';
import { Condition } from 'models/frontend/Condition/Condition';
import { Phenotype } from 'models/frontend/Phenotype/Phenotype';

/**
 * Zygosity a genotype needs at this allele's locus for this row's phenotype
 * to be expressed - copies of the *non-wild* allele, e.g. for `ed3`:
 * '0' = +/+ (wild-type homozygous, allele absent), '1' = ed3/+ (het),
 * '2' = ed3/ed3 (homozygous mutant), '1or2' = either (old "Dominant").
 * Stored on disk as `allele_exprs.dominance`, a plain 0-3 integer (the
 * column name/type predate this repurposing - `AlleleExpression.dominance`
 * is the correctly-typed read/write boundary for it, see
 * `dominanceToZygosity`/`zygosityToDominance` below).
 */
export type Zygosity = '0' | '1' | '2' | '1or2';

export const zygosityToDominance = (zygosity: Zygosity): number => {
  switch (zygosity) {
    case '2':
      return 0;
    case '1':
      return 1;
    case '1or2':
      return 2;
    case '0':
      return 3;
  }
};

export const dominanceToZygosity = (dominance: number): Zygosity => {
  switch (dominance) {
    case 0:
      return '2';
    case 1:
      return '1';
    case 2:
      return '1or2';
    default:
      return '0';
  }
};

export interface AlleleExpressionState {
  alleleName: string;
  expressingPhenotype: Phenotype;
  requiredPhenotypes: Phenotype[];
  suppressingPhenotypes: Phenotype[];
  requiredConditions: Condition[];
  suppressingConditions: Condition[];
  dominance: Zygosity;
}

export class AlleleExpression {
  alleleName: string;
  /** Phenotype attached to the allele that will be expressed */
  @Type(() => Phenotype)
  expressingPhenotype: Phenotype;

  /** Phenotypes that need to be present for the expressing phenotype to be visible */
  @Type(() => Phenotype)
  requiredPhenotypes: Phenotype[] = [];

  /** Phenotypes that "cover up" the visibility of the expressing phenotype */
  @Type(() => Phenotype)
  suppressingPhenotypes: Phenotype[] = [];

  /** Environmental conditions that need to be present for expressing phenotype to be visible */
  @Type(() => Condition)
  requiredConditions: Condition[] = [];

  /** Environmental that "cover up" the visibility of the expressing phenotype */
  @Type(() => Condition)
  suppressingConditions: Condition[] = [];

  /** Zygosity required for this row's phenotype to be expressed - see `Zygosity`. */
  dominance: Zygosity;

  constructor(fields: AlleleExpressionState) {
    this.expressingPhenotype =
      fields?.expressingPhenotype ??
      new Phenotype({
        name: '',
        shortName: '',
        wild: true,
      });
    this.alleleName = fields?.alleleName ?? '';
    this.dominance = fields?.dominance;
    this.requiredPhenotypes = fields?.requiredPhenotypes ?? [];
    this.suppressingPhenotypes = fields?.suppressingPhenotypes ?? [];
    this.requiredConditions = fields?.requiredConditions ?? [];
    this.suppressingConditions = fields?.suppressingConditions ?? [];
  }

  public static async createFromRecord(
    record: db_AlleleExpression
  ): Promise<AlleleExpression> {
    return new AlleleExpression({
      alleleName: record.alleleName,
      expressingPhenotype: Phenotype.createFromRecord(
        await getPhenotype(
          record.expressingPhenotypeName,
          record.expressingPhenotypeWild
        )
      ),
      requiredPhenotypes: (
        await getAlteringPhenotypes(
          record.alleleName,
          record.expressingPhenotypeName,
          record.expressingPhenotypeWild,
          true
        )
      ).map((req) => Phenotype.createFromRecord(req)),
      suppressingPhenotypes: (
        await getAlteringPhenotypes(
          record.alleleName,
          record.expressingPhenotypeName,
          record.expressingPhenotypeWild,
          false
        )
      ).map((sup) => Phenotype.createFromRecord(sup)),
      requiredConditions: (
        await getAlteringConditions(
          record.alleleName,
          record.expressingPhenotypeName,
          record.expressingPhenotypeWild,
          true
        )
      ).map((req) => Condition.createFromRecord(req)),
      suppressingConditions: (
        await getAlteringConditions(
          record.alleleName,
          record.expressingPhenotypeName,
          record.expressingPhenotypeWild,
          false
        )
      ).map((sup) => Condition.createFromRecord(sup)),
      dominance: dominanceToZygosity(record.dominance),
    });
  }

  @Exclude()
  public generateRecord(): db_AlleleExpression {
    return {
      alleleName: this.alleleName,
      expressingPhenotypeName: this.expressingPhenotype.name,
      expressingPhenotypeWild: this.expressingPhenotype.wild,
      dominance: zygosityToDominance(this.dominance),
    };
  }

  public toJSON(): string {
    return JSON.stringify(instanceToPlain(this));
  }

  static fromJSON(json: string): AlleleExpression {
    return plainToInstance(
      AlleleExpression,
      JSON.parse(json) as Record<string, unknown>
    );
  }
}
