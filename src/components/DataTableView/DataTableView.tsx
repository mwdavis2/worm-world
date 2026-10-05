import { open } from '@tauri-apps/api/dialog';
import { type Field } from 'components/ColumnFilter/ColumnFilter';
import DataImportForm from 'components/DataInputForm/DataInputForm';
import { Table, type ColumnDefinitionType } from 'components/Table/Table';
import { type FilterGroup } from 'models/db/filter/FilterGroup';
import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { FaEdit as EditIcon } from 'react-icons/fa';
import { getErrorMessage } from 'utils/getErrorMessage';
import { getPreferences, setPreferences } from 'utils/preferences';

interface DataTableProps<T, K> {
  title: string;
  dataName: string;
  cols: Array<ColumnDefinitionType<T>>;
  fields: Array<Field<T>>;
  nameMapping: { [key in keyof T]: K };
  insertRecord: (record: T) => Promise<void>;
  getFilteredRecords: (filterObj: FilterGroup<K>) => Promise<T[]>;
  getCountFilteredRecords: (filterObj: FilterGroup<K>) => Promise<number>;
  insertRecordsFromFile: (path: string) => Promise<void>;
  deleteRecord: (row: T) => Promise<void>;
  updateRecord?: (
    row: T,
    column: ColumnDefinitionType<T>,
    value: string
  ) => Promise<void>;
  // Overrides the default flat add-record form (DataImportForm) with a
  // custom one, e.g. for a record that needs more than a single-table
  // insert. Receives `refresh` to call once the custom form has saved.
  customAddForm?: (refresh: () => void) => React.JSX.Element;
  // Renders extra per-row actions (e.g. a custom "Edit" button) alongside
  // the default delete button. Receives `refresh` to call once a row action
  // has changed the data.
  customRowActions?: (row: T, refresh: () => void) => React.JSX.Element;
  // Saves an edited row (the row's key columns identify it and don't
  // change). When provided, each row gets an Edit button that opens the same
  // form used for adding, prefilled and with `lockedFields` read-only.
  updateRow?: (row: T) => Promise<void>;
  // The row's key columns, which can't be edited.
  lockedFields?: Array<keyof T>;
  // Deletes every row in the table. When provided, a "Clear table" button
  // (with a confirmation showing the row count) is shown next to Import.
  clearTable?: () => Promise<void>;
  // Names of the tables that must be cleared first because their rows
  // reference this one, used for a friendlier message when the delete is
  // refused by a foreign key.
  clearBlockedBy?: string;
  // Extra line shown in the clear confirmation (e.g. what can't be undone).
  clearWarning?: string;
}

export const PAGE_SIZES = [25, 50, 100, 200];

// Tauri's native dialog.open() presents a modal sheet on the app window; firing
// a second one before the first resolves leaves the extra sheet unresponsive
// to all input (macOS only tracks one active modal session per window).
let importInProgress = false;

const DataTableView = <T, K>(
  props: DataTableProps<T, K>
): React.JSX.Element => {
  const [data, setData] = useState<T[]>([]);
  const [page, setPage] = useState<number | undefined>(0);
  const [rowCount, setRowCount] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(
    getPreferences().dataTablePageSize
  );
  // Total rows in the whole table (ignoring filters), set when the clear
  // confirmation is opened; undefined while that dialog is closed.
  const [clearDialogTotal, setClearDialogTotal] = useState<number>();
  const [editingRow, setEditingRow] = useState<T>();

  const autoSize = (element: HTMLElement): void => {
    element.style.width = '0';
    const { borderLeftWidth, borderRightWidth } = getComputedStyle(element);
    /**
     * Turns a string like '36px' into the number 36
     */
    const numberPxToNumber = (numberPx: string): number =>
      parseInt(numberPx.slice(0, -2));
    const borderWidth =
      numberPxToNumber(borderLeftWidth) +
      numberPxToNumber(borderRightWidth) +
      17;
    // For some reason border is not included in scrollWidth
    element.style.width = `${element.scrollWidth + borderWidth}px`;
  };

  const [curFilter, setCurFilter] = useState<FilterGroup<K>>({
    filters: [],
    orderBy: [],
    limit: rowsPerPage,
    offset: (page ?? 0) * rowsPerPage,
  });

  const onRecordInsertionFormSubmission = (
    record: T,
    successCallback: () => void
  ): void => {
    props
      .insertRecord(record)
      .then((resp) => {
        successCallback();
        refresh();
      })
      .catch((e) => {
        toast.error(
          'An error has occured when inserting data: ' + getErrorMessage(e)
        );
      });
  };

  const onRecordEditSubmission = (
    original: T,
    edited: T,
    successCallback: () => void
  ): void => {
    // Merged over the original so columns the form doesn't show (e.g. a
    // variation's recombination range) are kept, not blanked.
    props
      .updateRow?.({ ...original, ...edited })
      .then(() => {
        toast.success('Saved changes');
        successCallback();
        refresh();
      })
      .catch((e) => {
        toast.error('Unable to save changes: ' + getErrorMessage(e));
      });
  };

  const deleteRecord = async (record: T): Promise<void> => {
    const wholeTable: FilterGroup<K> = { filters: [], orderBy: [] };
    try {
      const before = await props.getCountFilteredRecords(wholeTable);
      await props.deleteRecord(record);
      const after = await props.getCountFilteredRecords(wholeTable);
      // The delete reports success even when nothing matched the row, so say
      // so rather than leaving it looking like it worked.
      if (after >= before)
        toast.warning(
          'Nothing was deleted: no row in the database matched this one'
        );
      refresh();
    } catch (e) {
      toast.error(`Unable to delete record: ${getErrorMessage(e)}`);
    }
  };

  const importData = async (): Promise<void> => {
    if (importInProgress) {
      toast.error('An import is already in progress');
      return;
    }
    importInProgress = true;
    try {
      const filepath: string | null = (await open({
        filters: [
          {
            name: '',
            extensions: ['tsv', 'csv'],
          },
        ],
      })) as string | null;
      if (filepath === null) return;
      await props.insertRecordsFromFile(filepath);
      refresh();
      toast.success('Successfully imported data');
    } catch (e) {
      toast.error(
        'An error has occured when importing data: ' + getErrorMessage(e)
      );
    } finally {
      importInProgress = false;
    }
  };

  // `overrides` lets a caller apply a new page/page size right away, before
  // the state set alongside it has been rendered.
  const applyFilters = (
    filterObj: FilterGroup<K>,
    overrides?: { page?: number; rowsPerPage?: number }
  ): void => {
    const size = overrides?.rowsPerPage ?? rowsPerPage;
    setCurFilter(filterObj);
    setPage((currentPage) => {
      const page = overrides?.page ?? currentPage;
      props
        .getCountFilteredRecords(filterObj)
        .then((c) => {
          if ((page ?? 0) > Math.ceil(c / size)) setPage(undefined);
          props
            .getFilteredRecords({
              ...filterObj,
              limit: size,
              offset: (page ?? 0) * size,
            })
            .then((ds) => {
              setData(ds);
            })
            .catch((e) =>
              toast.error('Unable to get data: ' + getErrorMessage(e), {
                toastId: props.dataName,
              })
            );
          setRowCount(c);
        })
        .catch((e) =>
          toast.error('Unable to get data: ' + getErrorMessage(e), {
            toastId: props.dataName,
          })
        );
      return page;
    });
  };

  const refresh = (): void => {
    applyFilters(curFilter);
  };

  const changePageSize = (size: number): void => {
    setPreferences({ dataTablePageSize: size });
    setRowsPerPage(size);
    applyFilters(curFilter, { page: 0, rowsPerPage: size });
  };

  const openClearDialog = (): void => {
    props
      .getCountFilteredRecords({ filters: [], orderBy: [] })
      .then(setClearDialogTotal)
      .catch((e) => {
        toast.error('Unable to get data: ' + getErrorMessage(e));
      });
  };

  const clearTable = async (): Promise<void> => {
    setClearDialogTotal(undefined);
    try {
      await props.clearTable?.();
      toast.success(`Cleared ${props.title}`);
    } catch (e) {
      const message = getErrorMessage(e);
      toast.error(
        props.clearBlockedBy !== undefined &&
          message.toLowerCase().includes('foreign key')
          ? `Can't clear ${props.title}: ${props.clearBlockedBy} still reference it. Clear those first.`
          : `Unable to clear ${props.title}: ${message}`
      );
    }
    applyFilters(curFilter, { page: 0 });
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className='flex flex-col'>
      <div className='grid grid-cols-3 place-items-center items-center px-6'>
        <div className='flex select-none flex-row justify-start pt-4'>
          <span className='mx-2 pt-1'>
            Page
            <input
              value={page !== undefined && rowCount > 0 ? page + 1 : ''}
              placeholder='1'
              type='number'
              className='ml-2 w-6 bg-base-200 text-right'
              onChange={(e) => {
                if (e.target.value === '') {
                  setPage(undefined);
                  refresh();
                  return;
                }
                const newPage = parseInt(e.target.value);
                if (
                  newPage > 0 &&
                  newPage <= Math.ceil(rowCount / rowsPerPage)
                ) {
                  setPage(newPage - 1);
                  refresh();
                  autoSize(e.target);
                }
              }}
            />
            <span className='opacity-60'>
              /{Math.ceil(rowCount / rowsPerPage)}
            </span>
          </span>
          <select
            aria-label='Rows per page'
            className='select select-ghost select-xs ml-2 mt-1'
            value={rowsPerPage}
            onChange={(e) => {
              changePageSize(parseInt(e.target.value));
            }}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </select>
          <span className='ml-6 pt-2 text-sm opacity-60'>
            {rowCount > 0 ? rowCount.toLocaleString() + ' total rows' : ''}
          </span>
        </div>
        <h1 className='col-start-2 py-6 text-3xl font-bold'>{props.title}</h1>
        <div className='flex w-full flex-row justify-end gap-2'>
          {props.customAddForm !== undefined ? (
            props.customAddForm(refresh)
          ) : (
            <DataImportForm
              title={props.title}
              className='justify-self-end'
              dataName={props.dataName}
              fields={props.fields}
              onSubmit={onRecordInsertionFormSubmission}
            />
          )}
          <button
            className='btn'
            onClick={() => {
              importData().catch(console.error);
            }}
          >
            Import
          </button>
          {props.clearTable !== undefined && (
            <button
              className='btn btn-ghost text-error'
              onClick={openClearDialog}
            >
              Clear table
            </button>
          )}
        </div>
      </div>
      {clearDialogTotal !== undefined && (
        <div className='modal modal-open'>
          <div className='modal-box'>
            <h3 className='text-lg font-bold'>Clear {props.title}?</h3>
            <p className='py-4'>
              {clearDialogTotal === 0
                ? 'This table is already empty.'
                : `This permanently deletes all ${clearDialogTotal.toLocaleString()} rows in ${
                    props.title
                  }, including any that your current filters are hiding. It can't be undone.`}
            </p>
            {props.clearWarning !== undefined && clearDialogTotal > 0 && (
              <p className='pb-4 text-warning'>{props.clearWarning}</p>
            )}
            <div className='modal-action'>
              <button
                className='btn'
                onClick={() => {
                  setClearDialogTotal(undefined);
                }}
              >
                Cancel
              </button>
              <button
                className='btn btn-error'
                disabled={clearDialogTotal === 0}
                onClick={() => {
                  clearTable().catch(console.error);
                }}
              >
                Delete all {clearDialogTotal.toLocaleString()} rows
              </button>
            </div>
          </div>
        </div>
      )}
      <div className='px-4 pb-12'>
        <Table
          applyFilters={applyFilters}
          nameMapping={props.nameMapping}
          data={data}
          offset={(page ?? 0) * rowsPerPage}
          columns={props.cols}
          fields={props.fields}
          updateRecord={
            props.updateRecord === undefined
              ? undefined
              : async (row, column, value) => {
                  props.updateRecord?.(row, column, value).catch(console.error);
                  refresh();
                }
          }
          deleteRecord={deleteRecord}
          customRowActions={
            props.customRowActions === undefined &&
            props.updateRow === undefined
              ? undefined
              : (row) => (
                  <>
                    {props.customRowActions?.(row, refresh)}
                    {props.updateRow !== undefined && (
                      <button
                        className='btn btn-ghost btn-xs'
                        title='Edit'
                        onClick={() => {
                          setEditingRow(row);
                        }}
                      >
                        <EditIcon />
                      </button>
                    )}
                  </>
                )
          }
        />
        {editingRow !== undefined && (
          <DataImportForm
            mode='edit'
            title={props.title}
            dataName={props.dataName + '-edit'}
            fields={props.fields}
            initialValues={editingRow}
            lockedFields={props.lockedFields}
            open={true}
            onClose={() => {
              setEditingRow(undefined);
            }}
            onSubmit={(edited, successCallback) => {
              onRecordEditSubmission(editingRow, edited, () => {
                successCallback();
              });
            }}
          />
        )}
      </div>
    </div>
  );
};

export default DataTableView;
