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
    expect(screen.getByTestId('strainCard')).toHaveClass('bg-base-200');

    rerender(<StrainCard strain={strains.emptyWild} id={''} />);
    expect(screen.getByTestId('strainCard')).toHaveClass('bg-base-100');
  });
});
