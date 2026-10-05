import { render, screen } from '@testing-library/react';
import * as strains from 'models/frontend/Strain/Strain.mock';
import EditorContext from 'components/EditorContext/EditorContext';
import StrainCard from './StrainCard';
import { Allele } from 'models/frontend/Allele/Allele';
import { AllelePair } from 'models/frontend/AllelePair/AllelePair';
import { Strain } from 'models/frontend/Strain/Strain';
import { Gene } from 'models/frontend/Gene/Gene';
import { Variation } from 'models/frontend/Variation/Variation';

const arrayAllele = new Allele({
  name: 'oxEx2254',
  variation: new Variation({ name: 'oxEx2254', chromosome: 'Ex' }),
  contents: '[Psnt-1::Flp, Punc-122::GAP-43::mScarlet, cbr-unc-119(+), NeoR]',
});

describe('StrainCard', () => {
  test('Empty strain shows "wild" label', () => {
    render(<StrainCard strain={strains.emptyWild} id={''} />);

    const body = screen.getByTestId('strainCard');
    expect(body).toHaveTextContent(/wild/i);
  });

  test('a lethal strain gets the grayed card background', () => {
    const lethal = strains.emptyWild.clone();
    lethal.lethal = true;
    const { rerender } = render(<StrainCard strain={lethal} id={''} />);
    expect(screen.getByTestId('strainCard').className).toContain(
      'linear-gradient(hsl(var(--bc)/0.2)'
    );

    rerender(<StrainCard strain={strains.emptyWild} id={''} />);
    expect(screen.getByTestId('strainCard')).toHaveClass('bg-base-100');
  });

  test('shows expressed phenotypes and Lethal in the viability line', () => {
    const strain = strains.emptyWild.clone();
    strain.exprPhenotypeNames = ['Unc', 'Dpy'];
    strain.lethal = true;
    render(<StrainCard strain={strain} id={''} />);

    const line = screen.getByTestId('strainCardViability');
    expect(line).toHaveTextContent('Unc, Dpy · Lethal');
    expect(line).toHaveAttribute('title', 'Unc · Dpy · Lethal');
  });

  test('keeps an empty viability line when there is nothing to show', () => {
    render(<StrainCard strain={strains.emptyWild} id={''} />);
    const line = screen.getByTestId('strainCardViability');
    expect(line).toBeInTheDocument();
    expect(line).toHaveTextContent('');
  });

  describe('allele labels follow the display mode', () => {
    // ed3 is an allele of unc-119; the strain is heterozygous (ed3 / +).
    const renderWithMode = (mode: string): HTMLElement => {
      render(
        <EditorContext.Provider value={{ alleleDisplayMode: mode }}>
          <StrainCard strain={strains.ed3Het} id={''} />
        </EditorContext.Provider>
      );
      return screen.getByTestId('strainCard');
    };

    test('name only', () => {
      const card = renderWithMode('name');
      expect(card).toHaveTextContent('ed3');
      expect(card).not.toHaveTextContent('unc-119(');
    });

    test('gene(name)', () => {
      expect(renderWithMode('gene-name')).toHaveTextContent('unc-119(ed3)');
    });

    test('an extrachromosomal array shows its contents in a contents mode', () => {
      const arrayStrain = new Strain({
        allelePairs: [
          new AllelePair({ top: arrayAllele, bot: arrayAllele.toWild() }),
        ],
      });
      render(
        <EditorContext.Provider value={{ alleleDisplayMode: 'name-contents' }}>
          <StrainCard strain={arrayStrain} id={''} />
        </EditorContext.Provider>
      );
      expect(screen.getByTestId('strainCard')).toHaveTextContent(
        'oxEx2254 [Psnt-1::Flp, Punc-122::GAP-43::mScarle…'
      );
    });

    test('gene(-/+) shows - for the mutant and + for the wild-type copy', () => {
      const card = renderWithMode('gene-sign');
      expect(card).toHaveTextContent('unc-119(-)');
      expect(card).toHaveTextContent('unc-119(+)');
    });
  });

  describe("a rearrangement's region", () => {
    const tmC5 = new Allele({
      name: 'tmC5',
      variation: new Variation({
        name: 'tmC5',
        chromosome: 'IV',
        physLoc: 9_550_000,
        geneticLoc: 4.31,
        recombination: [6_600_000, 12_500_000],
      }),
    });
    const marker = (
      name: string,
      physLoc: number,
      geneticLoc: number
    ): Allele =>
      new Allele({
        name,
        gene: new Gene({
          sysName: `${name}-g`,
          descName: name,
          chromosome: 'IV',
          physLoc,
          geneticLoc,
        }),
      });
    const early = marker('early', 8_000_000, 3.8);
    const unc43 = marker('unc43', 10_324_254, 4.58);
    const dpy20 = marker('dpy20', 11_696_430, 5.22);
    const het = (m: Allele): AllelePair =>
      new AllelePair({ top: m.toWild(), bot: m });

    const balanced = new Strain({
      allelePairs: [
        het(unc43),
        het(dpy20),
        new AllelePair({ top: tmC5, bot: tmC5.toWild() }),
      ],
    });
    const cardText = (strain: Strain): { text: string; card: HTMLElement } => {
      render(<StrainCard strain={strain} id={''} />);
      const card = screen.getByTestId('strainCard');
      return { text: card.textContent ?? '', card };
    };

    test('shows the balancer first, the region in brackets, and never "tmC5(+)"', () => {
      const { text } = cardText(balanced);
      expect(text).toMatch(/tmC5.*\[.*unc43\(\+\).*dpy20\(\+\).*\]/);
      expect(text).not.toContain('tmC5(+)');
      expect(text.split('[').length - 1).toBe(1);
      expect(text.split(']').length - 1).toBe(1);
    });

    test('a strain with no rearrangement has no brackets', () => {
      const { text } = cardText(
        new Strain({ allelePairs: [het(unc43), het(dpy20)] })
      );
      expect(text).not.toContain('[');
      expect(text).not.toContain(']');
    });

    test('the balancer column is the phase reference: swap arrows go on the marker columns', () => {
      // "early" sorts before the balancer by genetic position, but the
      // balancer is shown first, so the three marker columns can all be swapped.
      const { card } = cardText(
        new Strain({
          allelePairs: [
            het(early),
            het(unc43),
            het(dpy20),
            new AllelePair({ top: tmC5, bot: tmC5.toWild() }),
          ],
        })
      );
      expect(card.querySelectorAll('.text-primary')).toHaveLength(3);
    });
  });
});
