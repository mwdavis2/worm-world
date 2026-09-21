export interface BreedCountProbabilityProps {
  probability?: number;
}

const BreedCountProbability = (
  props: BreedCountProbabilityProps
): React.JSX.Element => {
  const getNForConfidence = (confidence: number): number => {
    if (
      confidence > 0.999 ||
      props.probability === 0 ||
      props.probability === undefined
    ) {
      return -1;
    }
    // Solved directly rather than by stepping n upward: the chance of seeing at
    // least one worm of interest in n picks is 1 - (1-p)^n, so the smallest
    // sufficient n is ln(1-confidence) / ln(1-p). The search loop this replaces
    // ran ~1/p times, which for rare recombinant strains (p ~ 1e-6) meant
    // millions of iterations per card on every render.
    const inc = props.probability >= 0.2 ? 1 : 5; // reported granularity
    const exactN = Math.log(1 - confidence) / Math.log(1 - props.probability);
    return Math.ceil(exactN / inc) * inc;
  };

  return (
    <div>
      <p className='text-xl'>Breed Count</p>
      <p data-testid={'countOne'}>
        {getNForConfidence(0.8)} for 80% Confidence
      </p>
      <progress
        data-testid={'progress-0.8'}
        className='progress progress-error w-56'
        value={0.8}
        max='1'
      ></progress>
      <p data-testid={'countTwo'}>
        {getNForConfidence(0.9)} for 90% Confidence
      </p>
      <progress
        data-testid={'progress-0.9'}
        className='progress progress-warning w-56'
        value={0.9}
        max='1'
      ></progress>
      <p data-testid={'countThree'}>
        {getNForConfidence(0.95)} for 95% Confidence
      </p>
      <progress
        data-testid={'progress-0.95'}
        className='progress progress-info w-56'
        value={0.95}
        max='1'
      ></progress>
      <p data-testid={'countFour'}>
        {getNForConfidence(0.99)} for 99% Confidence
      </p>
      <progress
        data-testid={'progress-0.99'}
        className='progress progress-success w-56'
        value={1}
        max='1'
      ></progress>
    </div>
  );
};

export default BreedCountProbability;
