import { render, screen } from '@testing-library/react';
import * as strains from 'models/frontend/Strain/Strain.mock';
import EditorContext from 'components/EditorContext/EditorContext';
import StrainCard from './StrainCard';
import { Allele } from 'models/frontend/Allele/Allele';
import { AllelePair } from 'models/frontend/AllelePair/AllelePair';
import { Strain } from 'models/frontend/Strain/Strain';
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
});
