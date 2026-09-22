import {
  deleteStrain,
  getCountFilteredStrains,
  getFilteredStrains,
  insertDbStrain,
  insertStrainsFromFile,
  updateStrain,
} from 'api/strain';
import AddStrainModal from 'components/AddStrainModal/AddStrainModal';
import { type Field } from 'components/ColumnFilter/ColumnFilter';
import DataTableView from 'components/DataTableView/DataTableView';
import { type ColumnDefinitionType } from 'components/Table/Table';
import { type db_Strain } from 'models/db/db_Strain';
import { type StrainFieldName } from 'models/db/filter/db_StrainFieldName';
import { useRef, useState } from 'react';
import { FaEdit as EditIcon } from 'react-icons/fa';

export const cols: Array<ColumnDefinitionType<db_Strain>> = [
  { key: 'name', header: 'Name' },
  { key: 'genotype', header: 'Genotype' },
  { key: 'description', header: 'Description' },
];

const fields: Array<Field<db_Strain>> = [
  {
    name: 'name',
    title: 'Name',
    type: 'text',
  },
  {
    name: 'genotype',
    title: 'Genotype',
    type: 'text',
  },
  {
    name: 'description',
    title: 'Description',
    type: 'text',
  },
];

const nameMapping: { [key in keyof db_Strain]: StrainFieldName } = {
  name: 'Name',
  genotype: 'Genotype',
  description: 'Description',
};

export default function StrainDataTable(): React.JSX.Element {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStrain, setEditingStrain] = useState<db_Strain>();
  // customAddForm/customRowActions are called during DataTableView's own
  // render with its current `refresh` closure - stash the latest one here so
  // AddStrainModal (rendered once, outside DataTableView) can call it after
  // a save without needing DataTableView to expose refresh directly.
  const refreshRef = useRef<() => void>(() => {});

  return (
    <>
      <DataTableView
        title='Strains'
        dataName='strain'
        cols={cols}
        fields={fields}
        nameMapping={nameMapping}
        getFilteredRecords={getFilteredStrains}
        getCountFilteredRecords={getCountFilteredStrains}
        insertRecord={insertDbStrain}
        insertRecordsFromFile={insertStrainsFromFile}
        deleteRecord={deleteStrain}
        updateRecord={async (row, column, value) => {
          const newRow = structuredClone(row);
          newRow[column.key] = value;
          await updateStrain(row.name, newRow);
        }}
        customAddForm={(refresh) => {
          refreshRef.current = refresh;
          return (
            <button
              className='btn'
              onClick={() => {
                setEditingStrain(undefined);
                setIsModalOpen(true);
              }}
            >
              Add New Strain
            </button>
          );
        }}
        customRowActions={(row, refresh) => {
          refreshRef.current = refresh;
          return (
            <button
              className='btn btn-ghost btn-xs'
              onClick={() => {
                setEditingStrain(row);
                setIsModalOpen(true);
              }}
            >
              <EditIcon />
            </button>
          );
        }}
      />
      <AddStrainModal
        isOpen={isModalOpen}
        setIsOpen={setIsModalOpen}
        strainToEdit={editingStrain}
        onSaved={() => {
          refreshRef.current();
        }}
      />
    </>
  );
}
