import { Exclude, instanceToPlain, plainToInstance } from 'class-transformer';
import { type db_Variation } from 'models/db/db_Variation';
import { type ChromosomeName } from 'models/db/filter/db_ChromosomeName';

interface iVariation {
  name: string;
  chromosome?: ChromosomeName;
  physLoc?: number; // Physical location of the gene on a chromosome
  geneticLoc?: number; // Gene's genetic distance from the middle of a chromosome
  recombination?: [number, number];
  // Flags this Variation as eligible for the New Allele dialog's "Location
  // lookup" control - only actually surfaced there if physLoc or geneticLoc
  // is also set (flag-true with neither set is silently excluded).
  isLocationReference?: boolean;
  // The extrachromosomal array's mitotic/germline loss rate (0-100). Not yet
  // consumed by the cross-calculation logic (backlog #4) - persisted only.
  percentLoss?: number;
}

export class Variation {
  name: string = ''; // Will be, by convention, same as allele name
  chromosome?: ChromosomeName;
  physLoc?: number; // Physical location of the gene on a chromosome
  geneticLoc?: number; // Gene's genetic distance from the middle of a chromosome
  recombination?: [number, number];
  isLocationReference: boolean = false;
  percentLoss?: number;

  constructor(fields: iVariation) {
    Object.assign(this, fields);
  }

  static createFromRecord(record: db_Variation): Variation {
    return new Variation({
      name: record.alleleName,
      physLoc: record.physLoc ?? undefined,
      geneticLoc: record.geneticLoc ?? undefined,
      chromosome: record.chromosome ?? undefined,
      recombination: record.recombSuppressor ?? undefined,
      isLocationReference: record.isLocationReference,
      percentLoss: record.percentLoss ?? undefined,
    });
  }

  @Exclude()
  public generateRecord(): db_Variation {
    return {
      alleleName: this.name,
      physLoc: this.physLoc ?? null,
      geneticLoc: this.geneticLoc ?? null,
      chromosome: this.chromosome ?? null,
      recombSuppressor: this.recombination ?? null,
      isLocationReference: this.isLocationReference,
      percentLoss: this.percentLoss ?? null,
    };
  }

  public toJSON(): string {
    return JSON.stringify(instanceToPlain(this));
  }

  static fromJSON(json: string): Variation {
    return plainToInstance(
      Variation,
      JSON.parse(json) as Record<string, unknown>
    );
  }
}
