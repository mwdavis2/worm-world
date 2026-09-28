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

export const pushTaskToGoogle = async (
  task: db_Task,
  title: string
): Promise<void> => {
  await invoke('push_task_to_google', { task, title });
};

/** Returns the local tasks that were changed by remote (Google) updates. */
export const syncGoogleTasksNow = async (): Promise<db_Task[]> => {
  return await invoke('sync_google_tasks_now');
};
