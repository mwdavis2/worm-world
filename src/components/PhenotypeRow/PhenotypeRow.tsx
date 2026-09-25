import {
  type CopyNumber,
  type PhenotypeRelationship,
  type PhenotypeRowState,
} from 'components/NewAlleleModal/newAlleleTypes';

export interface PhenotypeRowProps {
  row: PhenotypeRowState;
  onChange: (row: PhenotypeRowState) => void;
  onDelete: () => void;
}

const COPY_NUMBER_OPTIONS: Array<{ value: CopyNumber; label: string }> = [
  { value: '0', label: '0 copies' },
  { value: '1', label: '1 copy' },
  { value: '2', label: '2 copies' },
  { value: '1or2', label: '1 or 2 copies' },
];

const RELATIONSHIP_OPTIONS: Array<{
  value: PhenotypeRelationship;
  label: string;
}> = [
  { value: 'suppressedByPhenotype', label: 'Suppressed by Phenotype' },
  { value: 'requiresPhenotype', label: 'Requires Phenotype' },
  { value: 'suppressedByCondition', label: 'Suppressed by Condition' },
  { value: 'requiresCondition', label: 'Requires Condition' },
];

// A row with no name yet has no active consequence - dimmed to signal that,
// per the explicit design decision (rows with a blank name are excluded
// from whatever eventually gets written to the tables).
const PhenotypeRow = (props: PhenotypeRowProps): React.JSX.Element => {
  const { row } = props;
  const isInert = row.name === '';

  return (
    <div
      className={`flex flex-wrap items-center gap-2 border-b border-base-300 py-2 ${
        isInert ? 'opacity-50' : ''
      }`}
    >
      <select
        className='select select-bordered select-sm'
        value={row.copyNumber}
        onChange={(e) => {
          props.onChange({
            ...row,
            copyNumber: e.target.value as CopyNumber,
          });
        }}
      >
        {COPY_NUMBER_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <input
        type='text'
        placeholder='Name'
        className='input input-bordered input-sm w-32'
        value={row.name}
        onChange={(e) => {
          props.onChange({ ...row, name: e.target.value });
        }}
      />
      <label className='label cursor-pointer gap-1'>
        <span className='label-text'>Wild-type</span>
        <input
          type='checkbox'
          className='checkbox checkbox-sm'
          checked={row.isWildType}
          onChange={(e) => {
            props.onChange({ ...row, isWildType: e.target.checked });
          }}
        />
      </label>
      <label className='label cursor-pointer gap-1'>
        <span className='label-text'>Lethal</span>
        <input
          type='checkbox'
          className='checkbox checkbox-sm'
          checked={row.isLethal}
          onChange={(e) => {
            props.onChange({ ...row, isLethal: e.target.checked });
          }}
        />
      </label>
      <select
        className='select select-bordered select-sm'
        value={row.relationship ?? ''}
        onChange={(e) => {
          const value = e.target.value;
          props.onChange({
            ...row,
            relationship:
              value === '' ? undefined : (value as PhenotypeRelationship),
          });
        }}
      >
        <option value=''>—</option>
        {RELATIONSHIP_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <input
        type='text'
        placeholder='Other condition or phenotype'
        className='input input-bordered input-sm w-40'
        value={row.relationshipText}
        onChange={(e) => {
          props.onChange({ ...row, relationshipText: e.target.value });
        }}
      />
      <button
        type='button'
        aria-label='Delete phenotype row'
        className='btn btn-ghost btn-sm'
        onClick={props.onDelete}
      >
        🗑
      </button>
    </div>
  );
};

export default PhenotypeRow;
