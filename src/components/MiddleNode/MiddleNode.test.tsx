import { render } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';
import { NodeType } from 'models/enums';
import { StrainFilter } from 'models/frontend/StrainFilter/StrainFilter';
import MiddleNode from './MiddleNode';

const renderNode = (data: StrainFilter): HTMLElement =>
  render(
    <ReactFlowProvider>
      <MiddleNode id='m1' data={data} type={NodeType.Self} />
    </ReactFlowProvider>
  ).container;

describe('MiddleNode filter tooltip', () => {
  test('lists the active filters, one per line', () => {
    const container = renderNode(
      new StrainFilter({ alleleNames: new Set(['unc-5']) })
    );
    const tips = [...container.querySelectorAll('[data-tip]')].map((el) =>
      el.getAttribute('data-tip')
    );
    expect(tips).toContain('Alleles: unc-5\nViability: Non-lethal');
  });

  test('says so when no filter is set', () => {
    const container = renderNode(new StrainFilter({ viability: new Set() }));
    const tips = [...container.querySelectorAll('[data-tip]')].map((el) =>
      el.getAttribute('data-tip')
    );
    expect(tips).toContain('No filters');
  });
});
