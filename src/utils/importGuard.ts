// Tauri's native dialog.open() presents a modal sheet on the app window; firing
// a second one before the first resolves leaves the extra sheet unresponsive
// to all input (macOS only tracks one active modal session per window). Every
// import button shares this one flag so only a single import dialog or import
// runs at a time.
let importInProgress = false;

/** @returns false (and changes nothing) if an import is already running */
export const beginImport = (): boolean => {
  if (importInProgress) return false;
  importInProgress = true;
  return true;
};

export const endImport = (): void => {
  importInProgress = false;
};
