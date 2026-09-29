import { invoke } from '@tauri-apps/api/tauri';
import { type db_SyncAccount } from 'models/db/sync/db_SyncAccount';
import { type db_Task } from 'models/db/task/db_Task';

export const getSyncAccounts = async (): Promise<db_SyncAccount[]> => {
  return await invoke('get_sync_accounts');
};

export const connectGoogleTasks = async (): Promise<db_SyncAccount> => {
  return await invoke('connect_google_tasks');
};

export const disconnectGoogleTasks = async (
  syncAccountId: string
): Promise<void> => {
  await invoke('disconnect_google_tasks', { syncAccountId });
};

export const connectAppleReminders = async (
  email: string,
  appPassword: string
): Promise<db_SyncAccount> => {
  return await invoke('connect_apple_reminders', { email, appPassword });
};

export const disconnectAppleReminders = async (
  syncAccountId: string
): Promise<void> => {
  await invoke('disconnect_apple_reminders', { syncAccountId });
};

/** Pushes to every connected sync account (Google, Apple, both, or neither). */
export const pushTask = async (task: db_Task, title: string): Promise<void> => {
  await invoke('push_task_to_sync_accounts', { task, title });
};

/** Returns the local tasks that were changed by any connected account's remote updates. */
export const syncTasksNow = async (): Promise<db_Task[]> => {
  return await invoke('sync_all_accounts_now');
};
