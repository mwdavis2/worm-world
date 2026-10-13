import { toast } from 'react-toastify';
import {
  actionPrefix,
  describeDbError,
  type DbErrorContext,
} from 'utils/dbErrors';

/**
 * Shows a failed database call as a plain sentence with the original database
 * text on a "Details" line under it (or, for an error that could not be
 * translated, the action followed by what the app reported). The original is
 * also logged.
 */
export const toastDbError = (e: unknown, context: DbErrorContext): void => {
  console.error(e);
  const { message, details } = describeDbError(e, context);
  if (details === undefined) {
    toast.error(`${actionPrefix(context)}: ${message}`);
    return;
  }
  toast.error(
    <div>
      <div>{message}</div>
      <div className='mt-1 break-words text-xs opacity-70'>
        Details: {details}
      </div>
    </div>,
    // longer than a plain toast: there is a second line to read
    { autoClose: 8000 }
  );
};
