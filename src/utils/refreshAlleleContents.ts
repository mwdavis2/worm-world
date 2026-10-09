import { type Node } from 'reactflow';
import { NodeType } from 'models/enums';
import { type Strain } from 'models/frontend/Strain/Strain';

/**
 * A saved design carries its own copies of each strain's alleles, made when
 * the strain was added - so they miss anything stored on the allele since
 * (notably `contents`, which older code didn't even carry over). Given the
 * allele table's current contents text by allele name, brings every strain's
 * alleles up to date and returns the nodes: unchanged nodes as-is, and a new
 * node (with a cloned Strain, so memoized cards re-render) wherever
 * something changed. Only the display-only `contents` is touched.
 */
export const refreshAlleleContents = (
  nodes: Array<Node<any>>,
  contentsByAlleleName: Map<string, string | undefined>
): Array<Node<any>> =>
  nodes.map((node) => {
    if (node.type !== NodeType.Strain) return node;
    const strain = node.data as Strain;
    let changed = false;
    strain.getAlleles().forEach((allele) => {
      if (
        allele.isWild() ||
        allele.isAbsent() ||
        !contentsByAlleleName.has(allele.name)
      )
        return;
      const current = contentsByAlleleName.get(allele.name);
      if ((allele.contents ?? undefined) !== current) {
        allele.contents = current;
        changed = true;
      }
    });
    return changed ? { ...node, data: strain.clone() } : node;
  });
