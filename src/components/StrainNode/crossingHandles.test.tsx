import { render } from '@testing-library/react';
import StrainNode from 'components/StrainNode/StrainNode';
import * as strains from 'models/frontend/Strain/Strain.mock';
import { ReactFlowProvider } from 'reactflow';
import { afterEach, describe, expect, test } from 'vitest';
import { setPreferences } from 'utils/preferences';

const handles = (container: HTMLElement): Record<string, Element> => ({
  right: container.querySelector('.react-flow__handle-right') as Element,
  left: container.querySelector('.react-flow__handle-left') as Element,
  bottom: container.querySelector('.react-flow__handle-bottom') as Element,
});

const draw = (data: ReturnType<typeof strains.emptyWild.toMale>): HTMLElement =>
  render(
    <ReactFlowProvider>
      <StrainNode data={data} id='n' xPos={0} yPos={0} />
    </ReactFlowProvider>
  ).container;

afterEach(() => {
  localStorage.clear();
});

describe('crossing rectangles blocked by a phenotype', () => {
  test('a hermaphrodite with female and self defects has black right and bottom handles', () => {
    const herm = strains.emptyWild.clone();
    herm.femaleCrossingDefective = true;
    herm.selfCrossingDefective = true;
    const h = handles(draw(herm));
    expect(h.right.className).toContain('crossing-blocked');
    expect(h.bottom.className).toContain('crossing-blocked');
    expect(h.right.getAttribute('title')).toContain(
      'female crossing defective'
    );
    expect(h.bottom.getAttribute('title')).toContain('self crossing defective');
  });

  test('a male with a male defect has a black left handle only', () => {
    const male = strains.emptyWild.toMale();
    male.maleCrossingDefective = true;
    male.femaleCrossingDefective = true;
    const h = handles(draw(male));
    expect(h.left.className).toContain('crossing-blocked');
    expect(h.right.className).not.toContain('crossing-blocked');
    expect(h.bottom.className).not.toContain('crossing-blocked');
  });

  test('a card with no crossing effects has normal handles', () => {
    const h = handles(draw(strains.emptyWild.clone()));
    expect(h.right.className).not.toContain('crossing-blocked');
    expect(h.left.className).not.toContain('crossing-blocked');
    expect(h.bottom.className).not.toContain('crossing-blocked');
  });

  test('the Ignore crossing effects setting gives the handles back', () => {
    setPreferences({ ignoreCrossingEffects: true });
    const herm = strains.emptyWild.clone();
    herm.femaleCrossingDefective = true;
    herm.selfCrossingDefective = true;
    const h = handles(draw(herm));
    expect(h.right.className).not.toContain('crossing-blocked');
    expect(h.bottom.className).not.toContain('crossing-blocked');
  });
});
