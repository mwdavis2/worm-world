import {
  deleteAlleleConversion,
  deleteFilteredAlleleConversions,
  getCountFilteredAlleleConversions,
  getFilteredAlleleConversions,
  insertAlleleConversionsFromFile,
  insertDbAlleleConversion,
  updateDbAlleleConversion,
} from 'api/alleleConversion';
import { type db_AlleleConversion } from 'models/db/db_AlleleConversion';
import { type ColumnDefinitionType } from 'components/Table/Table';
import { type AlleleConversionFieldName } from 'models/db/filter/db_AlleleConversionFieldName';
import { type Field } from 'components/ColumnFilter/ColumnFilter';
import DataTableView from 'components/DataTableView/DataTableView';

export const cols: Array<ColumnDefinitionType<db_AlleleConversion>> = [
  { key: 'sourceAllele', header: 'Source Allele' },
  { key: 'productAllele', header: 'Product Allele' },
  { key: 'driverPhenotypeName', header: 'Driver Phenotype Name' },
  { key: 'driverPhenotypeWild', header: 'Driver Phenotype Wild' },
  { key: 'percentConversion', header: 'Percent Converted' },
  { key: 'description', header: 'Description' },
];

const fields: Array<Field<db_AlleleConversion>> = [
  {
    name: 'sourceAllele',
    title: 'Source Allele',
    type: 'text',
  },
  {
    name: 'productAllele',
    title: 'Product Allele',
    type: 'text',
  },
  {
    name: 'driverPhenotypeName',
    title: 'Driver Phenotype Name',
    type: 'text',
  },
  {
    name: 'driverPhenotypeWild',
    title: 'Driver Phenotype Wild',
    type: 'boolean',
  },
  {
    name: 'percentConversion',
    title: 'Percent Converted (0-100)',
    type: 'number',
  },
  {
    name: 'description',
    title: 'Description',
    type: 'text',
  },
];

const nameMapping: {
  [key in keyof db_AlleleConversion]: AlleleConversionFieldName;
} = {
  sourceAllele: 'SourceAllele',
  productAllele: 'ProductAllele',
  driverPhenotypeName: 'DriverPhenotypeName',
  driverPhenotypeWild: 'DriverPhenotypeWild',
  percentConversion: 'PercentConversion',
  description: 'Description',
};

export default function AlleleConversionDataTable(): React.JSX.Element {
  return (
    <DataTableView
      title='Allele Conversions'
      dataName='alleleConversion'
      tableName='allele_conversions'
      keyFields={[
        'sourceAllele',
        'productAllele',
        'driverPhenotypeName',
        'driverPhenotypeWild',
      ]}
      cols={cols}
      fields={fields}
      nameMapping={nameMapping}
      getFilteredRecords={getFilteredAlleleConversions}
      getCountFilteredRecords={getCountFilteredAlleleConversions}
      insertRecord={insertDbAlleleConversion}
      insertRecordsFromFile={insertAlleleConversionsFromFile}
      deleteRecord={deleteAlleleConversion}
      updateRow={updateDbAlleleConversion}
      lockedFields={[
        'sourceAllele',
        'productAllele',
        'driverPhenotypeName',
        'driverPhenotypeWild',
      ]}
      clearTable={async () => {
        await deleteFilteredAlleleConversions({ filters: [], orderBy: [] });
      }}
    />
  );
}
