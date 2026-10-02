import { useState } from 'react';
import {
  getAlleleDisplayMode,
  nextAlleleDisplayMode,
} from 'models/frontend/Allele/alleleDisplay';
import { getPreferences, setPreferences } from 'utils/preferences';

/**
 * The allele-label display mode (see ALLELE_DISPLAY_MODES), remembered
 * between launches and shared by every view that shows strain cards.
 * `cycle` moves to the next mode.
 */
export const useAlleleDisplayMode = (): {
  mode: string;
  label: string;
  cycle: () => void;
} => {
  const [mode, setMode] = useState(
    () => getAlleleDisplayMode(getPreferences().alleleDisplayMode).id
  );
  return {
    mode,
    label: getAlleleDisplayMode(mode).label,
    cycle: () => {
      const next = nextAlleleDisplayMode(mode);
      setPreferences({ alleleDisplayMode: next });
      setMode(next);
    },
  };
};
