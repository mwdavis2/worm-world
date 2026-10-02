import { type MenuItem } from 'components/Menu/Menu';
import { type AllelePair } from 'models/frontend/AllelePair/AllelePair';
import { DEFAULT_ALLELE_DISPLAY_MODE } from 'models/frontend/Allele/alleleDisplay';
import { createContext } from 'react';

const EditorContext = createContext<{
  alleleDisplayMode: string;
  openNote?: (id: string) => void;
  toggleHetPair?: (id: string, pair: AllelePair) => void;
  toggleSex?: (id: string) => void;
  getMenuItems?: (id: string) => MenuItem[];
}>({
  alleleDisplayMode: DEFAULT_ALLELE_DISPLAY_MODE,
});

export default EditorContext;
