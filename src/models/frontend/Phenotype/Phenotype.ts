import { Exclude, instanceToPlain, plainToInstance } from 'class-transformer';
import { type db_Phenotype } from 'models/db/db_Phenotype';

export interface AffectedTraits {
  /** How well the male can mate. 3 denotes max mating capabilities, 0 states worm is incabable of mating  */
  maleMating?: number;
  lethal?: boolean;
  /** Crossing effects: a strain expressing this cannot be used as the male parent of a cross (left rectangle) */
  maleCrossingDefective?: boolean;
  /** ...cannot be the hermaphrodite parent of a mated cross (right rectangle) */
  femaleCrossingDefective?: boolean;
  /** ...cannot self (bottom rectangle) */
  selfCrossingDefective?: boolean;
  /** A hermaphrodite expressing this produces males from a self cross */
  him?: boolean;
  /** Worm maturation is stunted */
  arrested?: boolean;
  /** Generational time for to be ready to breed */
  maturationDays?: number;
}

interface IPhenotype extends AffectedTraits {
  name: string;
  shortName: string;
  wild: boolean;
  description?: string;
}

export class Phenotype {
  name: string = '';
  shortName: string = '';
  wild: boolean = true;
  description?: string;
  maleMating?: number;
  lethal?: boolean;
  maleCrossingDefective?: boolean;
  femaleCrossingDefective?: boolean;
  selfCrossingDefective?: boolean;
  him?: boolean;
  arrested?: boolean;
  maturationDays?: number;

  constructor(fields: IPhenotype) {
    Object.assign(this, fields);
  }

  static createFromRecord(record: db_Phenotype): Phenotype {
    return new Phenotype({
      name: record.name,
      shortName: record.shortName,
      wild: record.wild,
      description: record.description ?? undefined,
      maleMating:
        record.maleMating !== null ? Number(record.maleMating) : undefined,
      lethal: record.lethal ?? undefined,
      maleCrossingDefective: record.maleCrossingDefective ?? undefined,
      femaleCrossingDefective: record.femaleCrossingDefective ?? undefined,
      selfCrossingDefective: record.selfCrossingDefective ?? undefined,
      him: record.him ?? undefined,
      arrested: record.arrested ?? undefined,
      maturationDays: record.maturationDays ?? undefined,
    });
  }

  @Exclude()
  public generateRecord(): db_Phenotype {
    return {
      name: this.name,
      shortName: this.shortName,
      wild: this.wild,
      description: this.description ?? null,
      maleMating: this.maleMating !== undefined ? this.maleMating : null,
      lethal: this.lethal ?? null,
      maleCrossingDefective: this.maleCrossingDefective ?? null,
      femaleCrossingDefective: this.femaleCrossingDefective ?? null,
      selfCrossingDefective: this.selfCrossingDefective ?? null,
      him: this.him ?? null,
      arrested: this.arrested ?? null,
      maturationDays: this.maturationDays ?? null,
    };
  }

  public getUniqueName(): string {
    return `${this.name}${this.wild ? ' (wild)' : ''}`;
  }

  public toJSON(): string {
    return JSON.stringify(instanceToPlain(this));
  }

  static fromJSON(json: string): Phenotype {
    return plainToInstance(
      Phenotype,
      JSON.parse(json) as Record<string, unknown>
    );
  }
}
