import {
  deleteVariation,
  updateDbVariation,
  deleteFilteredVariations,
  getCountFilteredVariations,
  getUnusedVariationNames,
  getFilteredVariations,
  insertDbVariation,
  insertVariationsFromFile,
} from 'api/variation';
import {
  type VariationRow,
  toDbVariation,
  toVariationRow,
  withDerivedGeneticLoc,
} from 'models/frontend/Variation/variationRow';
import { toast } from 'react-toastify';
import { type FilterGroup } from 'models/db/filter/FilterGroup';
import { type ColumnDefinitionType } from 'components/Table/Table';
import { chromosomes } from 'models/frontend/Chromosome';
import { type VariationFieldName } from 'models/db/filter/db_VariationFieldName';
import DataTableView from 'components/DataTableView/DataTableView';
import { type Field } from 'components/ColumnFilter/ColumnFilter';

export const cols: Array<ColumnDefinitionType<VariationRow>> = [
  { key: 'alleleName', header: 'Variation Name' },
  { key: 'chromosome', header: 'Chromosome' },
  { key: 'physLoc', header: 'Physical Location' },
  { key: 'geneticLoc', header: 'Genetic Location' },
  { key: 'recombSuppressorStart', header: 'Suppressed Range Start' },
  { key: 'recombSuppressorEnd', header: 'Suppressed Range End' },
  { key: 'isLocationReference', header: 'Location Reference' },
  { key: 'percentLoss', header: '% Loss' },
];

const fields: Array<Field<VariationRow>> = [
  {
    name: 'alleleName',
    title: 'Variation Name',
    type: 'text',
  },
  {
    name: 'chromosome',
    title: 'Chromosome Number',
    type: 'select',
    selectOptions: chromosomes,
  },
  {
    name: 'physLoc',
    title: 'Physical Location',
    type: 'number',
  },
  {
    name: 'geneticLoc',
    title: 'Genetic Location',
    type: 'number',
  },
  {
    name: 'recombSuppressorStart',
    title: 'Suppressed Range Start (bp)',
    type: 'number',
  },
  {
    name: 'recombSuppressorEnd',
    title: 'Suppressed Range End (bp)',
    type: 'number',
  },
  {
    name: 'isLocationReference',
    title: 'Location Reference',
    type: 'boolean',
  },
  {
    name: 'percentLoss',
    title: '% Loss',
    type: 'number',
  },
];

const nameMapping: { [key in keyof VariationRow]: VariationFieldName } = {
  alleleName: 'AlleleName',
  chromosome: 'Chromosome',
  physLoc: 'PhysLoc',
  geneticLoc: 'GenLoc',
  recombSuppressorStart: 'RecombSuppressorStart',
  recombSuppressorEnd: 'RecombSuppressorEnd',
  isLocationReference: 'IsLocationReference',
  percentLoss: 'PercentLoss',
};

// The table works on VariationRow (the suppressed range split into start and
// end columns); these adapt the api calls, which use the stored shape.
const getFilteredRows = async (
  filter: FilterGroup<VariationFieldName>
): Promise<VariationRow[]> =>
  (await getFilteredVariations(filter)).map(toVariationRow);

// Fills in a missing genetic position from the physical one (see
// withDerivedGeneticLoc) and tells the user, since it changes what they typed.
const withGeneticLoc = async (row: VariationRow): Promise<VariationRow> => {
  const { row: filledRow, filled } = await withDerivedGeneticLoc(row);
  if (filled)
    toast.info(
      `Genetic position set to ${String(
        filledRow.geneticLoc
      )} cM, worked out from the physical position`
    );
  return filledRow;
};

export default function VariationDataTable(): React.JSX.Element {
  return (
    <DataTableView
      title='Variations'
      dataName='variation'
      cols={cols}
      fields={fields}
      nameMapping={nameMapping}
      unused={{
        fieldName: 'Unused',
        hint: 'Unused: no allele uses this variation',
        getKeys: getUnusedVariationNames,
        rowKey: (row) => row.alleleName,
      }}
      getFilteredRecords={getFilteredRows}
      getCountFilteredRecords={getCountFilteredVariations}
      insertRecord={async (row) => {
        await insertDbVariation(toDbVariation(await withGeneticLoc(row)));
      }}
      insertRecordsFromFile={insertVariationsFromFile}
      deleteRecord={async (row) => {
        // Only the name picks the row, so don't validate the range here.
        const { recombSuppressorStart, recombSuppressorEnd, ...rest } = row;
        void recombSuppressorStart;
        void recombSuppressorEnd;
        await deleteVariation({ ...rest, recombSuppressor: null });
      }}
      updateRow={async (row) => {
        await updateDbVariation(toDbVariation(await withGeneticLoc(row)));
      }}
      lockedFields={['alleleName']}
      clearTable={async () => {
        await deleteFilteredVariations({ filters: [], orderBy: [] });
      }}
      clearBlockedBy='Alleles'
    />
  );
}
