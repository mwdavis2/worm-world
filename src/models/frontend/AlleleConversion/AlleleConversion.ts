import { type db_AlleleConversion } from 'models/db/db_AlleleConversion';

/**
 * A rule that turns an allele into another one in a germline that expresses a
 * driver phenotype (Cre/lox excision, FLP/FRT, ...). It is kept on the SOURCE
 * allele (`Allele.conversions`); `Strain.crossWith` applies it.
 */
export class AlleleConversion {
  /** Name of the allele this one becomes; it belongs to the same gene or variation */
  productName: string = '';
  /** The phenotype that has to be expressed (name and wild flag, like `Phenotype`) */
  driverName: string = '';
  driverWild: boolean = true;
  /** Chance, 0 to 100, that a copy converts when the driver is expressed */
  percentConversion: number = 100;
  description?: string;

  constructor(fields?: {
    productName: string;
    driverName: string;
    driverWild: boolean;
    percentConversion: number;
    description?: string;
  }) {
    if (fields !== undefined) Object.assign(this, fields);
  }

  static createFromRecord(record: db_AlleleConversion): AlleleConversion {
    return new AlleleConversion({
      productName: record.productAllele,
      driverName: record.driverPhenotypeName,
      driverWild: record.driverPhenotypeWild,
      percentConversion: record.percentConversion,
      description: record.description ?? undefined,
    });
  }

  /** The driver as `Phenotype.getUniqueName()` writes it, so it can be looked up among a parent's expressed phenotypes */
  public getDriverKey(): string {
    return `${this.driverName}${this.driverWild ? ' (wild)' : ''}`;
  }

  /** The chance as a 0-1 probability, for the calculation only */
  public getProbability(): number {
    return Math.min(1, Math.max(0, this.percentConversion / 100));
  }
}
