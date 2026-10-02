import { type AllelePair } from 'models/frontend/AllelePair/AllelePair';
import { Strain } from 'models/frontend/Strain/Strain';
import { DEFAULT_ALLELE_DISPLAY_MODE } from 'models/frontend/Allele/alleleDisplay';
import { createContext } from 'react';

const StrainCardContext = createContext<{
  strain: Strain;
  toggleHetPair?: (pair: AllelePair) => void;
  toggleSex?: () => void;
  alleleDisplayMode: string;
}>({
  strain: new Strain(),
  alleleDisplayMode: DEFAULT_ALLELE_DISPLAY_MODE,
});

export default StrainCardContext;
