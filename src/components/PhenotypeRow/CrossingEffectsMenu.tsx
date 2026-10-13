import {
  CROSSING_EFFECT_OPTIONS,
  crossingEffectsOf,
  type PhenotypeRowState,
} from 'components/NewAlleleModal/newAlleleTypes';

interface CrossingEffectsMenuProps {
  row: PhenotypeRowState;
  onChange: (row: PhenotypeRowState) => void;
}

/**
 * The "Crossing Effects" button of a phenotype row: a daisyUI dropdown whose
 * panel holds a real checkbox for each effect (male / female / self crossing
 * defective, Him). The dropdown is focus-driven, so it stays open while boxes
 * are ticked and closes when focus moves elsewhere.
 */
const CrossingEffectsMenu = (
  props: CrossingEffectsMenuProps
): React.JSX.Element => {
  const effects = crossingEffectsOf(props.row);
  const count = CROSSING_EFFECT_OPTIONS.filter(
    ({ key }) => effects[key]
  ).length;
  return (
    <div className='dropdown dropdown-end'>
      {/* a label, not a button: Safari/WebKit does not focus a clicked button, which a daisyUI dropdown needs */}
      <label
        tabIndex={0}
        role='button'
        className='btn btn-outline btn-sm gap-1 normal-case'
      >
        Crossing Effects
        {count > 0 && (
          <span className='badge badge-primary badge-sm'>{count}</span>
        )}
      </label>
      <div
        tabIndex={0}
        className='dropdown-content rounded-box z-50 w-72 bg-base-100 p-2 shadow'
      >
        {CROSSING_EFFECT_OPTIONS.map(({ key, label }) => (
          <label key={key} className='label cursor-pointer justify-start gap-2'>
            <input
              type='checkbox'
              className='checkbox checkbox-sm'
              checked={effects[key]}
              onChange={(e) => {
                props.onChange({ ...props.row, [key]: e.target.checked });
              }}
            />
            <span className='label-text'>{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
};

export default CrossingEffectsMenu;
