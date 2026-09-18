// Tauri commands reject with a db_Error-shaped object like { Delete: "..." }
// rather than a plain Error; unwrap that to the underlying message so toasts
// read as a sentence instead of raw JSON.
export const getErrorMessage = (e: unknown): string => {
  if (e !== null && typeof e === 'object') {
    const values = Object.values(e as Record<string, unknown>);
    if (values.length === 1 && typeof values[0] === 'string') {
      return values[0];
    }
  }
  if (e instanceof Error && e.message.length > 0) return e.message;
  return JSON.stringify(e);
};
