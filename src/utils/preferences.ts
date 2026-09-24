import { type TextExportMode } from 'utils/svgExport/textToPath';

const STORAGE_KEY = 'worm-world:preferences';

export type EdgeStyle = 'straight' | 'default'; // 'default' is react-flow's built-in bezier edge
export type { TextExportMode };

export interface Preferences {
  minZoom: number;
  edgeStyle: EdgeStyle;
  // Fraction (0-1). Children below this probability start hidden when a
  // cross is created. 0 disables the feature, since a probability can never
  // be less than 0.
  minChildProbability: number;
  textExportMode: TextExportMode;
}

export const DEFAULT_PREFERENCES: Preferences = {
  minZoom: 0.5,
  edgeStyle: 'straight',
  minChildProbability: 0,
  textExportMode: 'text',
};

export const getPreferences = (): Preferences => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return DEFAULT_PREFERENCES;
  try {
    return {
      ...DEFAULT_PREFERENCES,
      ...(JSON.parse(raw) as Partial<Preferences>),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
};

export const setPreferences = (update: Partial<Preferences>): Preferences => {
  const next = { ...getPreferences(), ...update };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
};
