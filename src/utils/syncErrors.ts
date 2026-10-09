import { toast } from 'react-toastify';
import { getErrorMessage } from 'utils/getErrorMessage';

/**
 * A sentence a person can act on for a failed Google Tasks sync, in place of the
 * technical text the sync code returns (an HTTP status and a long web address).
 * The original is still logged to the console for debugging.
 */
export const describeSyncProblem = (e: unknown): string => {
  const text = getErrorMessage(e);
  if (/\b404\b/.test(text))
    return "Google Tasks couldn't find this task, so it wasn't updated there. It may have been deleted in Google Tasks.";
  if (
    /\b(401|403)\b|invalid_grant|unauthori[sz]ed|forbidden|keyring|OAuth/i.test(
      text
    )
  )
    return 'Google Tasks needs you to sign in again. Reconnect it in Settings.';
  if (/\b429\b|rate limit|quota/i.test(text))
    return 'Google is busy right now. Try again in a minute.';
  if (/\b5\d\d\b|server error/i.test(text))
    return 'Google Tasks had a problem on its side. Try again in a little while.';
  if (
    /error sending request|connect|dns|network|timed out|timeout|AuthTimeout/i.test(
      text
    )
  )
    return "WormWorld couldn't reach Google. Check your internet connection.";
  if (/configuration|config/i.test(text))
    return "Google Tasks isn't set up correctly. Check it in Settings.";
  return "Google Tasks couldn't be updated.";
};

/**
 * Tells the user a push to Google Tasks failed after the change itself was
 * saved: a warning, not an error, since nothing was lost.
 */
export const toastSyncPushFailed = (e: unknown): void => {
  console.warn('Google Tasks sync failed:', e);
  toast.warning(`Your change is saved. ${describeSyncProblem(e)}`);
};

/** Tells the user a Google Tasks action they asked for (connect, sync now...) failed. */
export const toastSyncFailed = (what: string, e: unknown): void => {
  console.warn(`${what} failed:`, e);
  toast.error(`${what}. ${describeSyncProblem(e)}`);
};
