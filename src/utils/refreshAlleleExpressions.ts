import { type Node } from 'reactflow';
import { NodeType } from 'models/enums';
import { type Allele } from 'models/frontend/Allele/Allele';
import { type AlleleExpression } from 'models/frontend/AlleleExpression/AlleleExpression';
import { type Strain } from 'models/frontend/Strain/Strain';
import { instanceToPlain } from 'class-transformer';
import { mapLimit } from 'utils/mapLimit';

/**
 * A saved design carries its own copies of each strain's alleles, made when the
 * strain was added, expression rows (phenotypes, dominance, requirements)
 * included. When the data tables have changed since, those copies are out of
 * date and the cards would keep computing phenotypes from the old rows. These
 * bring them up to date when a design opens.
 */

const strainNodes = (nodes: Array<Node<any>>): Array<Node<Strain>> =>
  nodes.filter((node) => node.type === NodeType.Strain);

/** The names of the non-wild alleles the design's strains carry. */
export const allelesInDesign = (nodes: Array<Node<any>>): string[] => [
  ...new Set(
    strainNodes(nodes).flatMap((node) =>
      node.data
        .getAlleles()
        .filter((allele) => !allele.isWild())
        .map((allele) => allele.name)
    )
  ),
];

/**
 * Each allele's expression rows as the database holds them now. An allele that
 * can't be loaded (deleted from the data tables, say) is left out, so the
 * design keeps its saved copy.
 */
export const loadFreshExpressions = async (
  alleleNames: string[],
  load: (alleleName: string) => Promise<AlleleExpression[]>
): Promise<Map<string, AlleleExpression[]>> => {
  const fresh = new Map<string, AlleleExpression[]>();
  await mapLimit(alleleNames, 4, async (name) => {
    try {
      fresh.set(name, await load(name));
    } catch (e) {
      console.warn(`Keeping the saved expression rows of ${name}`, e);
    }
  });
  return fresh;
};

const rowsKey = (rows: AlleleExpression[]): string =>
  JSON.stringify(rows.map((row) => instanceToPlain(row)));

/**
 * Replaces the saved expression rows of every allele copy whose rows differ
 * from `fresh`. Returns every strain node as a new node (with a cloned strain,
 * so memoized cards re-render) when anything changed, otherwise the same nodes.
 */
export const applyFreshExpressions = (
  nodes: Array<Node<any>>,
  fresh: Map<string, AlleleExpression[]>
): { nodes: Array<Node<any>>; changed: boolean } => {
  let changed = false;
  strainNodes(nodes).forEach((node) => {
    node.data.getAlleles().forEach((allele: Allele) => {
      if (allele.isWild()) return;
      const rows = fresh.get(allele.name);
      if (rows === undefined) return;
      if (rowsKey(rows) !== rowsKey(allele.alleleExpressions)) {
        allele.alleleExpressions = rows;
        changed = true;
      }
    });
  });
  if (!changed) return { nodes, changed };
  return {
    changed,
    nodes: nodes.map((node) =>
      node.type === NodeType.Strain
        ? { ...node, data: (node.data as Strain).clone() }
        : node
    ),
  };
};
