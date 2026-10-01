import { instanceToPlain, plainToInstance, Transform } from 'class-transformer';
import { type Allele } from 'models/frontend/Allele/Allele';
import { type Strain } from 'models/frontend/Strain/Strain';
import { type Node } from 'reactflow';

export interface StrainFilterUpdate {
  field: keyof IStrainFilter;
  action: 'add' | 'remove' | 'clear' | 'set';
  name: string;
  filterId: string;
  // Only used by the 'set' action, for the boolean fields.
  value?: boolean;
}
export interface IStrainFilter {
  alleleNames: Set<string>;
  exprPhenotypes: Set<string>;
  reqConditions: Set<string>;
  supConditions: Set<string>;
  hiddenNodes: Set<string>;
  // Environmental conditions the user has declared as currently present for
  // this cross (e.g. a drug in the plate, a temperature) - distinct from
  // reqConditions/supConditions above, which are visibility-filter criteria
  // (does a strain *declare* this condition), not "is this condition true
  // right now." Unset/absent by default - a condition not in this set is
  // treated as not present. Feeds phenotype-expression resolution
  // (Strain.getExprPhenotypes), not just card visibility.
  activeConditions: Set<string>;
  // Show genotypes that express a lethal phenotype. Off by default for newly
  // created crosses (lethals are hidden); JSON saved before it existed loads
  // as on so old designs keep showing every child.
  showLethal: boolean;
}

export class StrainFilter implements IStrainFilter {
  @Transform((data: any) => new Set(data?.obj?.alleleNames))
  public alleleNames = new Set<string>();

  @Transform((data: any) => new Set(data?.obj?.exprPhenotypes))
  public exprPhenotypes = new Set<string>();

  @Transform((data: any) => new Set(data?.obj?.reqConditions))
  public reqConditions = new Set<string>();

  @Transform((data: any) => new Set(data?.obj?.supConditions))
  public supConditions = new Set<string>();

  @Transform((data: any) => {
    return new Set(data?.obj?.hiddenNodes);
  })
  public hiddenNodes: Set<string> = new Set<string>();

  @Transform((data: any) => new Set(data?.obj?.activeConditions))
  public activeConditions = new Set<string>();

  public showLethal = false;

  constructor(props?: Partial<IStrainFilter>) {
    if (props !== undefined) Object.assign(this, props);
  }

  public clone(): StrainFilter {
    return new StrainFilter({
      alleleNames: new Set(this.alleleNames),
      exprPhenotypes: new Set(this.exprPhenotypes),
      reqConditions: new Set(this.reqConditions),
      supConditions: new Set(this.supConditions),
      hiddenNodes: new Set(this.hiddenNodes),
      activeConditions: new Set(this.activeConditions),
      showLethal: this.showLethal,
    });
  }

  /**
   * True when no Set-based filter is set. Deliberately ignores `showLethal`,
   * so the middle-node filter icon doesn't change between a fresh cross
   * (lethals hidden by default) and an old saved design (lethals shown).
   */
  public isEmpty(): boolean {
    return (
      this.alleleNames.size === 0 &&
      this.exprPhenotypes.size === 0 &&
      this.reqConditions.size === 0 &&
      this.supConditions.size === 0 &&
      this.hiddenNodes.size === 0 &&
      this.activeConditions.size === 0
    );
  }

  /** Given a strain, extracts all information that a cross filter might use */
  public static getSingleFilterOptions(
    strainNode: Node<Strain>,
    parentAlleles: Allele[] = [],
    activeConditionsInEffect = new Set<string>()
  ): IStrainFilter {
    const reqConditions = new Set(
      [...strainNode.data.getReqConditions()].map((cond) => cond.name)
    );
    const supConditions = new Set(
      [...strainNode.data.getSupConditions()].map((cond) => cond.name)
    );
    return {
      alleleNames: new Set(
        strainNode.data.getAlleles().map((allele) => allele.getQualifiedName())
      ),
      exprPhenotypes: new Set(
        [
          ...strainNode.data.getExprPhenotypes(
            parentAlleles,
            activeConditionsInEffect
          ),
        ].map((phen) => phen.getUniqueName())
      ),
      reqConditions,
      supConditions,
      hiddenNodes: new Set<string>([strainNode.id]),
      // Candidate conditions worth offering an "is this present" toggle for -
      // anything any allele expression declares as required/suppressing.
      activeConditions: new Set([...reqConditions, ...supConditions]),
      showLethal: false,
    };
  }

  /** Combines the possible options from multiple strains into a cross filter options */
  public static getFilterOptions(
    strainNodes: Array<Node<Strain>>,
    parentAlleles: Allele[] = [],
    activeConditionsInEffect = new Set<string>()
  ): IStrainFilter {
    return strainNodes.reduce<IStrainFilter>(
      (allOptions, strainNode) => {
        const options = this.getSingleFilterOptions(
          strainNode,
          parentAlleles,
          activeConditionsInEffect
        );
        allOptions.alleleNames = new Set([
          ...allOptions.alleleNames,
          ...options.alleleNames,
        ]);
        allOptions.exprPhenotypes = new Set([
          ...allOptions.exprPhenotypes,
          ...options.exprPhenotypes,
        ]);
        allOptions.reqConditions = new Set([
          ...allOptions.reqConditions,
          ...options.reqConditions,
        ]);
        allOptions.supConditions = new Set([
          ...allOptions.supConditions,
          ...options.supConditions,
        ]);
        allOptions.hiddenNodes = new Set([
          ...allOptions.hiddenNodes,
          ...options.hiddenNodes,
        ]);
        allOptions.activeConditions = new Set([
          ...allOptions.activeConditions,
          ...options.activeConditions,
        ]);
        return allOptions;
      },
      {
        alleleNames: new Set(),
        exprPhenotypes: new Set(),
        reqConditions: new Set(),
        supConditions: new Set(),
        hiddenNodes: new Set(),
        activeConditions: new Set(),
        showLethal: false,
      }
    );
  }

  public update(update: StrainFilterUpdate): void {
    if (update.action === 'set') {
      if (update.field === 'showLethal')
        this.showLethal = update.value ?? false;
      return;
    }
    const options = this[update.field];
    if (typeof options === 'boolean') return;
    if (update.action === 'add') options.add(update.name);
    if (update.action === 'remove') options.delete(update.name);
    if (update.action === 'clear') options.clear();
  }

  public toJSON(): string {
    return JSON.stringify(instanceToPlain(this));
  }

  static fromJSON(json: string): StrainFilter {
    const plain = JSON.parse(json) as Record<string, unknown>;
    const filter = plainToInstance(StrainFilter, plain);
    // class-transformer only visits keys present in the source, so a field
    // added later keeps its class default for old JSON. showLethal must load
    // as on for designs saved before it existed (their children were never
    // hidden), not pick up the off-by-default used for new crosses.
    if (plain.showLethal === undefined) {
      // Interim name of this flag, inverted; may be in designs saved while it
      // was being built.
      const legacyHide = (plain as { hideLethal?: boolean }).hideLethal;
      filter.showLethal = legacyHide === undefined ? true : !legacyHide;
      delete (filter as unknown as { hideLethal?: boolean }).hideLethal;
    }
    return filter;
  }
}

export default StrainFilter;
