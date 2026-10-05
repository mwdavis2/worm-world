import { render } from '@testing-library/react';
import { ReactFlowProvider, useStoreApi } from 'reactflow';
import { NodeType } from 'models/enums';
import { StrainFilter } from 'models/frontend/StrainFilter/StrainFilter';
import MiddleNode from './MiddleNode';

type TestNode = Record<string, unknown> & { id: string };

// Puts children into the react-flow store before the node under test reads it.
const SeedNodes = (props: { nodes: TestNode[] }): null => {
  const store = useStoreApi();
  props.nodes.forEach((node) =>
    store.getState().nodeInternals.set(node.id, node as never)
  );
  return null;
};

const tipsOf = (container: HTMLElement): Array<string | null> =>
  [...container.querySelectorAll('[data-tip]')].map((el) =>
    el.getAttribute('data-tip')
  );

const renderNode = (
  data: StrainFilter,
  childNodes: TestNode[] = []
): HTMLElement =>
  render(
    <ReactFlowProvider>
      <SeedNodes nodes={childNodes} />
      <MiddleNode id='m1' data={data} type={NodeType.Self} />
    </ReactFlowProvider>
  ).container;

describe('MiddleNode filter tooltip', () => {
  test('lists the active filters, one per line', () => {
    const container = renderNode(
      new StrainFilter({ alleleNames: new Set(['unc-5']) })
    );
    expect(tipsOf(container)).toContain('Alleles: unc-5');
  });

  test('shows the default viability filter only when a child is lethal', () => {
    const child = (lethal: boolean): TestNode => ({
      id: 'c1',
      parentNode: 'm1',
      data: { lethal },
    });
    expect(tipsOf(renderNode(new StrainFilter(), [child(false)]))).toContain(
      'No filters'
    );
    expect(tipsOf(renderNode(new StrainFilter(), [child(true)]))).toContain(
      'Viability: Non-lethal'
    );
  });

  test('says so when no filter is set', () => {
    const container = renderNode(new StrainFilter({ viability: new Set() }));
    expect(tipsOf(container)).toContain('No filters');
  });
});
