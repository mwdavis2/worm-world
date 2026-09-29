import { deleteAllTasks, deleteTasks, getTasks, updateTask } from 'api/task';
import { pushTask, syncTasksNow } from 'api/taskSync';
import TaskList from 'components/TaskList/TaskList';
import { getTaskStatementText } from 'components/TaskItem/TaskItem';
import { Task } from 'models/frontend/Task/Task';
import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { GiCheckboxTree as CrossDesignIcon } from 'react-icons/gi';
import { deleteCrossDesign, getFilteredCrossDesigns } from 'api/crossDesign';
import { BiHide, BiShow, BiRefresh as SyncIcon } from 'react-icons/bi';
import { SiMicrogenetics as GeneIcon } from 'react-icons/si';
import EditorContext from 'components/EditorContext/EditorContext';
import { getErrorMessage } from 'utils/getErrorMessage';

export const ToDoView = (): React.JSX.Element => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [designNames, setDesignNames] = useState(new Map<string, string>());
  const [filteredOnDesignId, setFilteredOnDesignId] = useState<string>();
  const [stagedDesignId, setStagedDesignId] = useState<string>(); // Whose tasks are staged for deletion
  const [showCompleted, setShowCompleted] = useState(true);
  const [showGenes, setShowGenes] = useState(true);

  useEffect(() => {
    refreshTasks()
      .then(() => {
        setHasLoadedOnce(true);
      }) // prevents text from flashing on screen while loading tasks from db
      .catch((e) => toast.error('Unable to get data: ' + getErrorMessage(e)));

    refreshDesignNames().catch((e) =>
      toast.error('Unable to get crossDesignIds: ' + getErrorMessage(e))
    );

    // Best-effort - a task's local save should never depend on this, and
    // most alpha users won't have a Google account connected at all.
    handleSyncNow().catch(() => {});
  }, []);

  const refreshTasks = async (): Promise<void> => {
    const tasks = await getTasks();
    setTasks(tasks.map((task) => new Task(task)));
  };

  const refreshDesignNames = async (): Promise<void> => {
    const crossDesigns = await getFilteredCrossDesigns({
      filters: [[['Editable', 'False']]],
      orderBy: [],
    });
    setDesignNames(
      new Map(
        crossDesigns.map((crossDesign) => [crossDesign.id, crossDesign.name])
      )
    );
  };

  const handleUpdateTask = (task: Task): void => {
    const record = task.generateRecord();
    updateTask(record)
      .then(refreshTasks)
      .catch((e) =>
        toast.error('Unable to update task: ' + getErrorMessage(e))
      );
    pushTask(record, getTaskStatementText(task)).catch((e) =>
      toast.error('Unable to sync task: ' + getErrorMessage(e))
    );
  };

  const handleSyncNow = async (): Promise<void> => {
    // Pull remote changes first - otherwise pushing a task's stale local
    // state (e.g. still "incomplete" because it was only checked off on the
    // Google side) would immediately overwrite the very change we're about
    // to pull, undoing it before it's even applied locally.
    await syncTasksNow();

    // Push every currently-known task (now reflecting anything just pulled)
    // - covers tasks created before a Google account was connected, which
    // otherwise never get pushed at all since push only fires automatically
    // on new inserts/updates. push_task is idempotent (inserts once, patches
    // thereafter), so re-pushing an already-synced, unchanged task is
    // harmless.
    const currentTasks = (await getTasks()).map((record) => new Task(record));
    await Promise.all(
      currentTasks.map(async (task) => {
        await pushTask(task.generateRecord(), getTaskStatementText(task));
      })
    );
    await refreshTasks();
  };

  const handleDeleteTasks = (designId?: string): void => {
    (designId === undefined
      ? deleteAllTasks().then(async () => {
          await Promise.all(
            [...designNames.keys()].map(
              async (crossDesignId) => await deleteCrossDesign(crossDesignId)
            )
          );
        })
      : deleteTasks(designId).then(async () => {
          await deleteCrossDesign(designId);
        })
    )
      .then(refreshTasks)
      .then(() => {
        setFilteredOnDesignId(undefined);
      })
      .catch((e) =>
        toast.error('Unable to delete tasks: ' + getErrorMessage(e))
      );
  };

  const hasFilter = filteredOnDesignId !== undefined;
  const crossDesignIds = new Set<string>(
    tasks.map((task) => task.crossDesignId)
  );
  const filteredTasks = tasks.filter(
    (task) =>
      (!hasFilter || task.crossDesignId === filteredOnDesignId) &&
      (showCompleted || !task.completed)
  );

  return (
    <div>
      {hasLoadedOnce && tasks.length === 0 ? (
        <NoTaskPlaceholder />
      ) : (
        <EditorContext.Provider value={{ showGenes }}>
          <TaskDeleteModal
            tasks={tasks.filter(
              (task) => task.crossDesignId === stagedDesignId
            )}
            crossDesignName={
              stagedDesignId !== undefined
                ? designNames.get(stagedDesignId)
                : ''
            }
            stagedId={stagedDesignId}
            clearStagedDesignId={() => {
              setStagedDesignId(undefined);
            }}
            deleteTasks={() => {
              handleDeleteTasks(stagedDesignId);
            }}
          />
          <div className='flex gap-2'>
            <div className='flex-grow'>
              <CrossDesignFilter
                setFilteredOnDesignId={setFilteredOnDesignId}
                crossDesignIds={crossDesignIds}
                designNames={designNames}
              />
            </div>
            <div className='flex gap-2 justify-self-end'>
              <SyncNowButton
                onClick={() => {
                  handleSyncNow().catch((e) =>
                    toast.error('Unable to sync tasks: ' + getErrorMessage(e))
                  );
                }}
              />
              <ShowCompletedButton
                showCompleted={showCompleted}
                toggleShowCompleted={() => {
                  setShowCompleted(!showCompleted);
                }}
              />
              <ShowGenesButton
                toggleShowGenes={() => {
                  setShowGenes(!showGenes);
                }}
              />
              <TaskRemovalButton
                tasks={tasks}
                hasFilter={hasFilter}
                filteredOnDesignId={filteredOnDesignId}
                designNames={designNames}
                deleteTasks={handleDeleteTasks}
                clearStagedDesignId={() => {
                  setStagedDesignId(undefined);
                }}
              />
            </div>
          </div>
          <TaskList
            refresh={refreshTasks}
            tasks={filteredTasks}
            updateTask={handleUpdateTask}
            setStagedDesignId={setStagedDesignId}
          />
        </EditorContext.Provider>
      )}
    </div>
  );
};

const NoTaskPlaceholder = (): React.JSX.Element => {
  return (
    <div className='m-14 flex flex-col items-center justify-center'>
      <h2 className='text-2xl'>No scheduled tasks yet.</h2>
      <h3 className='my-4 text-xl'>
        Tasks can be scheduled when viewing a cross design in the editor.
      </h3>
      <CrossDesignIcon className='my-4 text-9xl text-base-300' />
    </div>
  );
};

const SyncNowButton = (props: { onClick: () => void }): React.JSX.Element => {
  return (
    <div className='tooltip tooltip-bottom' data-tip={'Sync tasks'}>
      <button className='btn btn-outline' onClick={props.onClick}>
        <SyncIcon size='20' />
      </button>
    </div>
  );
};

interface ShowCompletedButtonProps {
  showCompleted: boolean;
  toggleShowCompleted: () => void;
}

const ShowCompletedButton = (
  props: ShowCompletedButtonProps
): React.JSX.Element => {
  const tooltipText = props.showCompleted
    ? 'Hide completed tasks'
    : 'Show completed tasks';
  return (
    <div className='tooltip tooltip-bottom' data-tip={tooltipText}>
      <button className='btn btn-outline' onClick={props.toggleShowCompleted}>
        {props.showCompleted ? <BiShow size='20' /> : <BiHide size='20' />}
      </button>
    </div>
  );
};

const ShowGenesButton = (props: {
  toggleShowGenes: () => void;
}): React.JSX.Element => {
  return (
    <div className='tooltip tooltip-bottom' data-tip={'Show genes'}>
      <button className='btn btn-outline' onClick={props.toggleShowGenes}>
        <GeneIcon size='20' />
      </button>
    </div>
  );
};

const TaskRemovalButton = (props: {
  hasFilter: boolean;
  filteredOnDesignId?: string;
  designNames: Map<string, string>;
  tasks: Task[];
  deleteTasks: (crossDesignId?: string) => void;
  clearStagedDesignId: () => void;
}): React.JSX.Element => {
  const crossDesignName =
    props.filteredOnDesignId === undefined
      ? undefined
      : props.designNames.get(props.filteredOnDesignId);
  return (
    <div>
      <label htmlFor='delete-tasks-modal' className='btn btn-error btn-outline'>
        {props.hasFilter ? 'Delete tasks' : 'Delete all tasks'}
      </label>
      <input type='checkbox' id='delete-tasks-modal' className='modal-toggle' />
      <label htmlFor='delete-tasks-modal' className='modal cursor-pointer'>
        <label className='modal-box relative text-center' htmlFor=''>
          <h2 className='text-3xl font-bold'>Delete Tasks</h2>
          <div className='divider' />
          <p className='text-lg'>
            {props.hasFilter ? (
              `Are you sure you want to remove tasks for "${crossDesignName}"? This cannot be undone.`
            ) : (
              <span>
                Are you sure you want to remove{' '}
                <span className='font-bold'> all </span> tasks? This will delete
                every task from every cross design.
              </span>
            )}
          </p>

          <div className='modal-action justify-center'>
            <label
              htmlFor='delete-tasks-modal'
              className='btn btn-error'
              onClick={() => {
                props.deleteTasks(props.filteredOnDesignId);
              }}
            >
              Delete
            </label>
            <label htmlFor='delete-tasks-modal' className='btn'>
              Cancel
            </label>
          </div>
        </label>
      </label>
    </div>
  );
};

const TaskDeleteModal = (props: {
  tasks: Task[];
  crossDesignName?: string;
  stagedId?: string;
  clearStagedDesignId: () => void;
  deleteTasks: () => void;
}): React.JSX.Element => {
  return (
    <>
      <input type='checkbox' className='modal-toggle' />
      <div className={`modal ${props.stagedId !== undefined && 'modal-open'}`}>
        <div className='modal-box relative text-center'>
          <h2 className='text-3xl font-bold'>
            {props.crossDesignName} Complete
          </h2>
          <div className='divider' />
          <p className='text-lg'>
            You have completed all tasks for {props.crossDesignName}. Would you
            like to remove them?
          </p>
          <div className='modal-action justify-center'>
            <button
              className='btn btn-success'
              onClick={() => {
                props.deleteTasks();
                props.clearStagedDesignId();
              }}
            >
              Remove
            </button>
            <button
              className='btn'
              onClick={() => {
                props.clearStagedDesignId();
              }}
            >
              Keep
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

interface CrossDesignFilterProps {
  setFilteredOnDesignId: (id?: string) => void;
  crossDesignIds: Set<string>;
  designNames: Map<string, string>;
}

const CrossDesignFilter = (
  props: CrossDesignFilterProps
): React.JSX.Element => {
  return (
    <div className='flex flex-col'>
      <label>
        <span className='label-text'>Filter Tasks By Cross Design</span>
      </label>
      <select
        onChange={(e) => {
          props.setFilteredOnDesignId(
            e.target.value === '' ? undefined : e.target.value
          );
        }}
        className='select select-primary w-full max-w-xs'
      >
        <option value={''}>{'No Filter'}</option>
        {Array.from(props.crossDesignIds).map((id: string) => {
          return (
            <option key={id} value={id}>
              {props.designNames.get(id)}
            </option>
          );
        })}
      </select>
    </div>
  );
};

export default ToDoView;
