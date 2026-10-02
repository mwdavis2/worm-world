import { useState } from 'react';
import { toast } from 'react-toastify';

export interface FieldType<T> {
  name: keyof T;
  title: string;
  type: 'text' | 'number' | 'boolean' | 'select';
  selectOptions?: string[];
}

export interface DataImportFormProps<T> {
  className?: string;
  title: string;
  dataName: string;
  fields: Array<FieldType<T>>;
  onSubmit: (arg0: T, successCallback: () => void) => void;
  // Edit mode: reuse the form to change an existing row. It opens controlled
  // by `open`/`onClose` (no "Add New" button), prefilled from `initialValues`,
  // with `lockedFields` (the row's key columns) shown read-only.
  mode?: 'add' | 'edit';
  initialValues?: T;
  lockedFields?: Array<keyof T>;
  open?: boolean;
  onClose?: () => void;
}

interface FieldsProps<T> {
  fieldList: Array<FieldType<T>>;
  initialValues?: T;
  lockedFields?: Array<keyof T>;
}

const Fields = <T,>(props: FieldsProps<T>): React.JSX.Element => {
  const fieldList = props.fieldList;
  const editing = props.initialValues !== undefined;
  const initialOf = (field: FieldType<T>): unknown =>
    props.initialValues?.[field.name];
  const isLocked = (field: FieldType<T>): boolean =>
    props.lockedFields?.includes(field.name) ?? false;
  return (
    <div>
      {fieldList?.map((field: FieldType<T>) => {
        if (field.type === 'boolean') {
          return (
            <div
              className='form-control my-1'
              key={'key-' + field.name.toString()}
            >
              <label className='label cursor-pointer'>
                <span className='label-text'>{field.title}</span>
                <input
                  type='checkbox'
                  className='checkbox'
                  name={field.name.toString()}
                  defaultChecked={initialOf(field) === true}
                  disabled={isLocked(field)}
                />
              </label>
            </div>
          );
        } else if (field.type === 'select') {
          const key = 'key-' + field.name.toString();
          return (
            <div className='my-1' key={key}>
              <label className='label'>
                <span className='label-text'>{field.title}</span>
                <select
                  className='select select-bordered w-full max-w-xs'
                  key={key}
                  name={field.name.toString()}
                  defaultValue={
                    editing ? String(initialOf(field) ?? '') : undefined
                  }
                  disabled={isLocked(field)}
                >
                  {/* When editing a row whose value is empty, keep it empty
                      rather than silently picking the first option. */}
                  {editing && (initialOf(field) ?? '') === '' && (
                    <option value=''></option>
                  )}
                  {field.selectOptions?.map((option: string) => {
                    return (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    );
                  })}
                </select>
              </label>
            </div>
          );
        } else {
          return (
            <div className='my-1' key={'key-' + field.name.toString()}>
              <label className='label'>
                <span className='label-text'>{field.title}</span>
                <input
                  type='text'
                  className='input input-bordered w-full max-w-xs'
                  key={'key-' + field.name.toString()}
                  name={field.name.toString()}
                  defaultValue={
                    editing ? String(initialOf(field) ?? '') : undefined
                  }
                  disabled={isLocked(field)}
                />
              </label>
            </div>
          );
        }
      })}
    </div>
  );
};

const DataImportForm = <T,>(
  props: DataImportFormProps<T>
): React.JSX.Element => {
  const [isFormOpenState, setFormOpen] = useState(false);
  const isEdit = props.mode === 'edit';
  const isFormOpen = props.open ?? isFormOpenState;
  // Bumped on every close so the form's (uncontrolled) inputs remount blank,
  // instead of showing whatever was typed the last time it was open.
  const [formKey, setFormKey] = useState(0);
  const closeForm = (): void => {
    setFormKey((key) => key + 1);
    if (props.onClose !== undefined) props.onClose();
    else setFormOpen(false);
  };

  const handleSubmit = (event: React.ChangeEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const record: any = {};
    for (const field of props.fields) {
      if (props.lockedFields?.includes(field.name) === true) {
        // Locked inputs are disabled (so not in the form data): keep the
        // row's own value.
        record[field.name] = props.initialValues?.[field.name];
        continue;
      }
      const datum = data.get(field.name.toString());
      let boolValue: boolean = false;
      if (field.type === 'boolean') {
        if (datum === 'on') {
          boolValue = true;
        }
        record[field.name] = boolValue;
      } else if (field.type === 'number' && datum != null && datum !== '') {
        if (Number.isNaN(+datum)) {
          toast(
            `Please enter a valid number for the field:  + ${String(
              field.name
            )}`
          );
          return;
        }
        record[field.name] = +datum;
      } else {
        if (datum === '' || datum === null) {
          record[field.name] = null;
        } else {
          record[field.name] = datum.toString().trim();
        }
      }
    }
    props.onSubmit(record, closeForm);
  };

  return (
    <div className={props.className}>
      {props.open === undefined && (
        <label
          htmlFor={'add-new-' + props.dataName}
          className='btn'
          onClick={() => {
            setFormOpen(true);
          }}
        >
          {'Add New ' + props.title.slice(0, -1)}
        </label>
      )}
      <input
        type='checkbox'
        id={'add-new-' + props.dataName}
        className='modal-toggle'
        readOnly
        checked={isFormOpen}
      />
      <div className='modal cursor-pointer'>
        <div className='absolute h-full w-full' onClick={closeForm} />
        <div className='modal-box relative'>
          <h2 className='text-center text-3xl'>
            {isEdit ? 'Edit ' + props.title.slice(0, -1) : 'New ' + props.title}
          </h2>
          <hr className='my-2' />
          <form key={formKey} onSubmit={handleSubmit}>
            <Fields
              fieldList={props.fields}
              initialValues={props.initialValues}
              lockedFields={props.lockedFields}
            ></Fields>
            <hr className='my-8' />
            <div className='flex w-full flex-row justify-center'>
              <input
                className='btn'
                type='submit'
                value={isEdit ? 'Save Changes' : 'Insert Into Database'}
              ></input>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default DataImportForm;
