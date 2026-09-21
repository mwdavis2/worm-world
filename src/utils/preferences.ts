const STORAGE_KEY = 'worm-world:preferences';

export type EdgeStyle = 'straight' | 'default'; // 'default' is react-flow's built-in bezier edge

export interface Preferences {
  minZoom: number;
  edgeStyle: EdgeStyle;
}

export const DEFAULT_PREFERENCES: Preferences = {
  minZoom: 0.5,
  edgeStyle: 'straight',
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
