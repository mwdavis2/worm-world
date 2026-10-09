import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { toast } from 'react-toastify';
import {
  describeSyncProblem,
  toastSyncFailed,
  toastSyncPushFailed,
} from 'utils/syncErrors';

const URL_TEXT =
  'https://tasks.googleapis.com/tasks/v1/lists/YUtJLVV6MWhnTnd2RnpkVw/tasks/eGpVSDJBX3g0V1duQTE0UQ/move?parent=OGNwTnJSUFFGdkE1eFJtVQ';

describe('describeSyncProblem', () => {
  test('a 404 says Google could not find the task, with no address or ids', () => {
    const message = describeSyncProblem({
      Http: `HTTP status client error (404 Not Found) for url (${URL_TEXT})`,
    });
    expect(message).toBe(
      "Google Tasks couldn't find this task, so it wasn't updated there. It may have been deleted in Google Tasks."
    );
    expect(message).not.toMatch(/https?:|googleapis|404|eGp/);
  });

  test.each([
    ['HTTP status client error (401 Unauthorized) for url (x)'],
    ['HTTP status client error (403 Forbidden) for url (x)'],
    ['OAuth error: invalid_grant'],
    ['Keyring error: no entry'],
  ])('%s -> sign in again', (text) => {
    expect(describeSyncProblem(new Error(text))).toBe(
      'Google Tasks needs you to sign in again. Reconnect it in Settings.'
    );
  });

  test('rate limits, server errors and no connection each have a plain sentence', () => {
    expect(
      describeSyncProblem(
        new Error('HTTP status client error (429 Too Many Requests)')
      )
    ).toBe('Google is busy right now. Try again in a minute.');
    expect(
      describeSyncProblem(
        new Error('HTTP status server error (503 Service Unavailable)')
      )
    ).toBe(
      'Google Tasks had a problem on its side. Try again in a little while.'
    );
    expect(
      describeSyncProblem(
        new Error(
          'error sending request for url (https://tasks.googleapis.com/x)'
        )
      )
    ).toBe("WormWorld couldn't reach Google. Check your internet connection.");
    expect(
      describeSyncProblem(
        new Error('Timed out waiting for the browser sign-in to complete')
      )
    ).toBe("WormWorld couldn't reach Google. Check your internet connection.");
  });

  test('a missing setting, and anything else, never shows the raw text', () => {
    expect(
      describeSyncProblem(
        new Error('Sync account is missing required configuration: client id')
      )
    ).toBe("Google Tasks isn't set up correctly. Check it in Settings.");
    const other = describeSyncProblem(
      new Error('something odd with id abc123 at https://x.y/z')
    );
    expect(other).toBe("Google Tasks couldn't be updated.");
  });

  test('a database-side "not found" is not mistaken for a Google 404', () => {
    expect(describeSyncProblem({ Db: 'cross design D1 not found' })).toBe(
      "Google Tasks couldn't be updated."
    );
  });
});

describe('the toasts', () => {
  beforeEach(() => {
    vi.spyOn(toast, 'warning').mockReturnValue(0);
    vi.spyOn(toast, 'error').mockReturnValue(0);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('a failed push after a saved change is a warning that says the change is saved', () => {
    toastSyncPushFailed({
      Http: `HTTP status client error (404 Not Found) for url (${URL_TEXT})`,
    });
    expect(toast.warning).toHaveBeenCalledTimes(1);
    const text = (toast.warning as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(text.startsWith('Your change is saved. ')).toBe(true);
    expect(text).not.toMatch(/https?:|googleapis|eGp/);
    expect(toast.error).not.toHaveBeenCalled();
    // the technical text is kept for debugging
    expect(console.warn).toHaveBeenCalled();
  });

  test('a failed action the user asked for is an error with a plain reason', () => {
    toastSyncFailed(
      "Couldn't sync with Google Tasks",
      new Error('error sending request')
    );
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't sync with Google Tasks. WormWorld couldn't reach Google. Check your internet connection."
    );
  });
});
