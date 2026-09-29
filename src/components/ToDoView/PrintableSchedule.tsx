import { fs } from '@tauri-apps/api';
import { save } from '@tauri-apps/api/dialog';
import { getTaskStatementText } from 'components/TaskItem/TaskItem';
import { getDateSections, isOverdue } from 'components/TaskList/TaskList';
import moment from 'moment';
import { type Task } from 'models/frontend/Task/Task';
import { toast } from 'react-toastify';
import { getErrorMessage } from 'utils/getErrorMessage';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const diffDays = (start: Date, end: Date): number => {
  return (
    (Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) -
      Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) /
    MS_PER_DAY
  );
};

interface ScheduleSections {
  overdue: Task[];
  upcoming: Array<[string, Task[]]>;
}

/** Mirrors TaskList's own grouping (Overdue, then date-keyed sections in
 * chronological order) so printed/exported output matches what's on screen. */
const buildSections = (tasks: Task[]): ScheduleSections => {
  const overdue = tasks
    .filter(isOverdue)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const upcomingTasks = tasks.filter((task) => !isOverdue(task));
  const upcoming = Array.from(getDateSections(upcomingTasks))
    .map((entry): [string, Task[]] => [entry[0], [...entry[1]]])
    .sort(([date1], [date2]) =>
      moment(date1).isAfter(moment(date2)) ? 1 : -1
    );
  return { overdue, upcoming };
};

const taskDetailSuffix = (task: Task): string => {
  if (task.completed && task.completedAt !== undefined) {
    return ` - completed ${task.completedAt.toLocaleDateString()}`;
  }
  if (isOverdue(task)) {
    const days = diffDays(task.dueDate, new Date());
    return ` - ${days} ${days === 1 ? 'day' : 'days'} overdue`;
  }
  return '';
};

export const buildScheduleText = (
  tasks: Task[],
  designNames: Map<string, string>
): string => {
  const { overdue, upcoming } = buildSections(tasks);
  const lines: string[] = [
    'Worm World Task Schedule',
    `Generated ${new Date().toLocaleString()}`,
    '',
  ];

  const appendSection = (title: string, sectionTasks: Task[]): void => {
    lines.push(title);
    sectionTasks.forEach((task) => {
      const designName = designNames.get(task.crossDesignId);
      let line = `  - ${getTaskStatementText(task)}`;
      if (designName !== undefined) line += ` (${designName})`;
      line += ` - due ${task.dueDate.toLocaleDateString()}`;
      line += taskDetailSuffix(task);
      lines.push(line);
      if (task.notes !== undefined && task.notes !== '') {
        lines.push(`      Notes: ${task.notes}`);
      }
    });
    lines.push('');
  };

  if (overdue.length > 0) {
    appendSection(`Overdue (${overdue.length})`, overdue);
  }
  upcoming.forEach(([date, sectionTasks]) => {
    appendSection(`${date} (${sectionTasks.length})`, sectionTasks);
  });
  if (overdue.length === 0 && upcoming.length === 0) {
    lines.push('No tasks to show.');
  }

  return lines.join('\n');
};

// Tauri's native dialog.save() presents a modal sheet on the app window;
// firing a second one before the first resolves leaves the extra sheet
// unresponsive (same issue as CustomControls.tsx's image export).
let textExportInProgress = false;

export const exportScheduleAsText = (
  tasks: Task[],
  designNames: Map<string, string>
): void => {
  if (textExportInProgress) {
    toast.error('An export is already in progress');
    return;
  }
  textExportInProgress = true;
  const text = buildScheduleText(tasks, designNames);
  const filename = `worm-world-schedule-${new Date().toISOString()}.txt`;

  save({
    defaultPath: filename,
    filters: [{ name: 'Text', extensions: ['txt'] }],
  })
    .then(async (filePath) => {
      // workaround because of this: https://github.com/tauri-apps/tauri/issues/4633
      if (window.__TAURI_IPC__ !== undefined) {
        if (filePath === null) {
          // user cancelled the save dialog
          return;
        }
        await fs.writeTextFile(filePath, text);
        toast.success('Exported schedule to ' + filePath);
      } else {
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.setAttribute('download', filename);
        a.setAttribute('href', url);
        a.click();
        URL.revokeObjectURL(url);
      }
    })
    .catch((e) => {
      toast.error(getErrorMessage(e));
    })
    .finally(() => {
      textExportInProgress = false;
    });
};

interface PrintableScheduleProps {
  tasks: Task[];
  designNames: Map<string, string>;
}

const PrintableSchedule = (
  props: PrintableScheduleProps
): React.JSX.Element => {
  const { overdue, upcoming } = buildSections(props.tasks);
  const isEmpty = overdue.length === 0 && upcoming.length === 0;

  return (
    <div className='hidden w-full p-8 text-black print:block'>
      {/* global.css centers all h1s by default - undo that here so the
          title doesn't center within the app shell's full-viewport-width
          ancestor and clip past the printed page's right edge. */}
      <h1 className='text-left text-2xl font-bold'>Worm World Task Schedule</h1>
      <p className='mb-4 text-sm'>Generated {new Date().toLocaleString()}</p>
      {isEmpty && <p>No tasks to show.</p>}
      {overdue.length > 0 && (
        <PrintSection
          title={`Overdue (${overdue.length})`}
          tasks={overdue}
          designNames={props.designNames}
        />
      )}
      {upcoming.map(([date, sectionTasks]) => (
        <PrintSection
          key={date}
          title={`${date} (${sectionTasks.length})`}
          tasks={sectionTasks}
          designNames={props.designNames}
        />
      ))}
    </div>
  );
};

const PrintSection = (props: {
  title: string;
  tasks: Task[];
  designNames: Map<string, string>;
}): React.JSX.Element => {
  return (
    <div className='mb-4 break-inside-avoid'>
      <h2 className='border-b-2 border-black text-lg font-semibold'>
        {props.title}
      </h2>
      <ul className='ml-4 list-disc'>
        {props.tasks.map((task) => (
          <PrintTaskRow
            key={task.id}
            task={task}
            designName={props.designNames.get(task.crossDesignId)}
          />
        ))}
      </ul>
    </div>
  );
};

const PrintTaskRow = (props: {
  task: Task;
  designName?: string;
}): React.JSX.Element => {
  const { task } = props;
  return (
    <li className='mb-1'>
      <span>{getTaskStatementText(task)}</span>
      {props.designName !== undefined && <span> ({props.designName})</span>}
      <span> - due {task.dueDate.toLocaleDateString()}</span>
      <span>{taskDetailSuffix(task)}</span>
      {task.notes !== undefined && task.notes !== '' && (
        <div className='ml-4 italic'>Notes: {task.notes}</div>
      )}
    </li>
  );
};

export default PrintableSchedule;
