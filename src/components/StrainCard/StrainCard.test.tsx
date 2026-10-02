import { render, screen } from '@testing-library/react';
import * as strains from 'models/frontend/Strain/Strain.mock';
import StrainCard from './StrainCard';

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
});
