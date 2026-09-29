import { TopNav } from 'components/TopNav/TopNav';
import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import {
  connectAppleReminders,
  connectGoogleTasks,
  disconnectAppleReminders,
  disconnectGoogleTasks,
  getSyncAccounts,
} from 'api/taskSync';
import { type db_SyncAccount } from 'models/db/sync/db_SyncAccount';
import { getErrorMessage } from 'utils/getErrorMessage';
import {
  type EdgeStyle,
  type TextExportMode,
  getPreferences,
  setPreferences,
} from 'utils/preferences';

const Settings = (): React.JSX.Element => {
  const [preferences, setLocalPreferences] = useState(getPreferences());
  const [syncAccounts, setSyncAccounts] = useState<db_SyncAccount[]>([]);
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [connectingApple, setConnectingApple] = useState(false);
  const [appleEmail, setAppleEmail] = useState('');
  const [applePassword, setApplePassword] = useState('');

  useEffect(() => {
    refreshSyncAccounts().catch((e) =>
      toast.error('Unable to get connected accounts: ' + getErrorMessage(e))
    );
  }, []);

  const refreshSyncAccounts = async (): Promise<void> => {
    setSyncAccounts(await getSyncAccounts());
  };

  const handleConnectGoogle = (): void => {
    setConnectingGoogle(true);
    connectGoogleTasks()
      .then(refreshSyncAccounts)
      .catch((e) =>
        toast.error('Unable to connect Google Tasks: ' + getErrorMessage(e))
      )
      .finally(() => {
        setConnectingGoogle(false);
      });
  };

  const handleConnectApple = (): void => {
    setConnectingApple(true);
    connectAppleReminders(appleEmail, applePassword)
      .then(async () => {
        await refreshSyncAccounts();
        setAppleEmail('');
        setApplePassword('');
      })
      .catch((e) =>
        toast.error('Unable to connect Apple Reminders: ' + getErrorMessage(e))
      )
      .finally(() => {
        setConnectingApple(false);
      });
  };

  const handleDisconnect = (account: db_SyncAccount): void => {
    const disconnect =
      account.provider === 'apple'
        ? disconnectAppleReminders
        : disconnectGoogleTasks;
    disconnect(account.id)
      .then(refreshSyncAccounts)
      .catch((e) =>
        toast.error('Unable to disconnect account: ' + getErrorMessage(e))
      );
  };

  const googleAccount = syncAccounts.find((a) => a.provider === 'google');
  const appleAccount = syncAccounts.find((a) => a.provider === 'apple');

  const updateMinZoom = (value: number): void => {
    setLocalPreferences(setPreferences({ minZoom: value }));
  };

  const updateEdgeStyle = (value: EdgeStyle): void => {
    setLocalPreferences(setPreferences({ edgeStyle: value }));
  };

  const updateMinChildProbabilityPercent = (percent: number): void => {
    const clamped = Number.isFinite(percent)
      ? Math.min(100, Math.max(0, percent))
      : 0;
    setLocalPreferences(setPreferences({ minChildProbability: clamped / 100 }));
  };

  const updateTextExportMode = (value: TextExportMode): void => {
    setLocalPreferences(setPreferences({ textExportMode: value }));
  };

  return (
    <>
      <TopNav title={'Settings'} />
      <div className='mx-16 my-8 flex max-w-md flex-col gap-6'>
        <div className='form-control'>
          <label className='label' htmlFor='minZoom'>
            <span className='label-text'>
              Minimum zoom in cross design editor
            </span>
          </label>
          <div className='flex items-center gap-4'>
            <input
              id='minZoom'
              type='range'
              min={0.1}
              max={1}
              step={0.05}
              value={preferences.minZoom}
              className='range'
              onChange={(e) => {
                updateMinZoom(Number(e.target.value));
              }}
            />
            <span className='w-12 text-right'>
              {preferences.minZoom.toFixed(2)}
            </span>
          </div>
          <label className='label'>
            <span className='label-text-alt'>
              Lower values let you zoom out further, at the cost of smaller
              genotype text.
            </span>
          </label>
        </div>

        <div className='form-control'>
          <label className='label' htmlFor='edgeStyle'>
            <span className='label-text'>Cross design link line style</span>
          </label>
          <select
            id='edgeStyle'
            className='select select-bordered'
            value={preferences.edgeStyle}
            onChange={(e) => {
              updateEdgeStyle(e.target.value as EdgeStyle);
            }}
          >
            <option value='straight'>Straight</option>
            <option value='default'>Curved</option>
          </select>
        </div>

        <div className='form-control'>
          <label className='label' htmlFor='minChildProbability'>
            <span className='label-text'>
              Auto-hide new children below this probability
            </span>
          </label>
          <div className='flex items-center gap-2'>
            <input
              id='minChildProbability'
              type='number'
              min={0}
              max={100}
              step={0.25}
              value={preferences.minChildProbability * 100}
              className='input input-bordered w-32'
              onChange={(e) => {
                updateMinChildProbabilityPercent(Number(e.target.value));
              }}
            />
            <span>%</span>
          </div>
          <label className='label'>
            <span className='label-text-alt'>
              Children below this percentage are hidden automatically when a
              cross is created; use the cross&apos;s filter menu to reveal them.
              0% disables this.
            </span>
          </label>
        </div>

        <div className='form-control'>
          <label className='label' htmlFor='textExportMode'>
            <span className='label-text'>SVG export text rendering</span>
          </label>
          <select
            id='textExportMode'
            className='select select-bordered'
            value={preferences.textExportMode}
            onChange={(e) => {
              updateTextExportMode(e.target.value as TextExportMode);
            }}
          >
            <option value='text'>Text</option>
            <option value='textPath'>Text path</option>
          </select>
          <label className='label'>
            <span className='label-text-alt'>
              &quot;Text&quot; produces editable, selectable text (relies on a
              fallback font if Lato isn&apos;t installed on the machine that
              opens the file). &quot;Text path&quot; embeds exact glyph
              outlines, so text is always pixel-perfect but no longer editable
              as text.
            </span>
          </label>
        </div>

        <div className='form-control'>
          <label className='label'>
            <span className='label-text'>Google Tasks</span>
          </label>
          {googleAccount === undefined ? (
            <button
              className='btn btn-outline'
              disabled={connectingGoogle}
              onClick={handleConnectGoogle}
            >
              {connectingGoogle ? 'Connecting...' : 'Connect Google Tasks'}
            </button>
          ) : (
            <div className='flex items-center justify-between gap-4'>
              <span>Connected as {googleAccount.accountLabel}</span>
              <button
                className='btn btn-error btn-outline'
                onClick={() => {
                  handleDisconnect(googleAccount);
                }}
              >
                Disconnect
              </button>
            </div>
          )}
          <label className='label'>
            <span className='label-text-alt'>
              Two-way syncs worm-world tasks with Google Tasks - checking a task
              off or rescheduling it in either app updates the other. Only tasks
              that started in worm-world are synced.
            </span>
          </label>
        </div>

        <div className='form-control'>
          <label className='label'>
            <span className='label-text'>Apple Reminders</span>
          </label>
          {appleAccount === undefined ? (
            <div className='flex flex-col gap-2'>
              <input
                type='email'
                placeholder='Apple ID email'
                className='input input-bordered'
                value={appleEmail}
                onChange={(e) => {
                  setAppleEmail(e.target.value);
                }}
              />
              <input
                type='password'
                placeholder='App-specific password'
                className='input input-bordered'
                value={applePassword}
                onChange={(e) => {
                  setApplePassword(e.target.value);
                }}
              />
              <button
                className='btn btn-outline'
                disabled={
                  connectingApple || appleEmail === '' || applePassword === ''
                }
                onClick={handleConnectApple}
              >
                {connectingApple ? 'Connecting...' : 'Connect Apple Reminders'}
              </button>
            </div>
          ) : (
            <div className='flex items-center justify-between gap-4'>
              <span>Connected as {appleAccount.accountLabel}</span>
              <button
                className='btn btn-error btn-outline'
                onClick={() => {
                  handleDisconnect(appleAccount);
                }}
              >
                Disconnect
              </button>
            </div>
          )}
          <label className='label'>
            <span className='label-text-alt'>
              Two-way syncs worm-world tasks with a shared &quot;Worm
              World&quot; list in Reminders, tagged by cross design. Apple
              doesn&apos;t support signing in directly - generate an
              app-specific password at{' '}
              <a
                href='https://appleid.apple.com/account/manage'
                target='_blank'
                rel='noreferrer'
                className='link'
              >
                appleid.apple.com/account/manage
              </a>{' '}
              and use it here instead of your real password.
            </span>
          </label>
        </div>
      </div>
    </>
  );
};

export default Settings;
