// Raw icon path data extracted from react-icons, so a hand-built SVG export
// can draw them directly without rendering any React/DOM at all. Source:
// node_modules/react-icons/{io5,tb,bi}/index.esm.js.
export interface IconSpec {
  viewBoxSize: number;
  d: string;
  // Stroke-based icons (Tb set) need fill:none + an explicit stroke;
  // fill-based icons (Io5/Bi sets) are filled with the given color and have
  // no stroke.
  stroke?: boolean;
  strokeWidth?: number; // stroke-based icons only; defaults to 2
  // A second, filled path drawn in the same coordinates, with its own
  // transform inside the icon (the self cross's X sits inside its loop).
  filled?: { d: string; transform: string };
}

export const MALE_ICON: IconSpec = {
  viewBoxSize: 512,
  d: 'M442 48h-90a22 22 0 000 44h36.89l-60.39 60.39c-68.19-52.86-167-48-229.54 14.57C31.12 234.81 31.12 345.19 99 413a174.21 174.21 0 00246 0c62.57-62.58 67.43-161.35 14.57-229.54L420 123.11V160a22 22 0 0044 0V70a22 22 0 00-22-22zM313.92 381.92a130.13 130.13 0 01-183.84 0c-50.69-50.68-50.69-133.16 0-183.84s133.16-50.69 183.84 0 50.69 133.16 0 183.84z',
};

export const HERM_ICON: IconSpec = {
  viewBoxSize: 512,
  d: 'M426 16h-74a22 22 0 000 44h20.89l-37.1 37.09A157.68 157.68 0 00216 42c-87.12 0-158 70.88-158 158 0 79.66 59.26 145.72 136 156.46V394h-28a22 22 0 000 44h28v36a22 22 0 0044 0v-36h28a22 22 0 000-44h-28v-37.54c76.74-10.74 136-76.8 136-156.46a157.15 157.15 0 00-14-64.92l44-44V112a22 22 0 0044 0V38a22 22 0 00-22-22zM216 314a114 114 0 11114-114 114.13 114.13 0 01-114 114z',
};

// The same drawing as components/SelfCrossIcon: a line curling once
// counter-clockwise, with the cross X (X_ICON's shape, scaled) in the curl.
export const SELF_ICON: IconSpec = {
  viewBoxSize: 24,
  d: 'M7.5 1.5V10A5.8 5.8 0 0 0 19.1 10A5.8 5.8 0 0 0 7.5 10V22M4.3 19L7.5 22.3L10.7 19',
  stroke: true,
  strokeWidth: 1.8,
  filled: {
    d: 'm16.192 6.344-4.243 4.242-4.242-4.242-1.414 1.414L10.535 12l-4.242 4.242 1.414 1.414 4.242-4.242 4.243 4.242 1.414-1.414L13.363 12l4.243-4.242z',
    transform: 'translate(13.3 10) scale(0.46) translate(-12 -12)',
  },
};

export const X_ICON: IconSpec = {
  viewBoxSize: 24,
  d: 'm16.192 6.344-4.243 4.242-4.242-4.242-1.414 1.414L10.535 12l-4.242 4.242 1.414 1.414 4.242-4.242 4.243 4.242 1.414-1.414L13.364 12l4.242-4.242z',
};
