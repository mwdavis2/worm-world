import {
  CROSSING_EFFECT_OPTIONS,
  type CrossingEffects,
} from 'components/NewAlleleModal/newAlleleTypes';

interface CrossingEffectsMenuProps {
  /** Unset effects read as off */
  effects: Partial<CrossingEffects>;
  onChange: (effects: CrossingEffects) => void;
  disabled?: boolean;
}

/**
 * The "Crossing Effects" button of a phenotype row (and of the Basic view's
 * phenotype boxes): a daisyUI dropdown whose panel holds a real checkbox for
 * each effect (male / female / self crossing defective, Him). The dropdown is
 * focus-driven, so it stays open while boxes are ticked and closes when focus
 * moves elsewhere.
 */
const CrossingEffectsMenu = (
  props: CrossingEffectsMenuProps
): React.JSX.Element => {
  const effects: CrossingEffects = {
    maleCrossingDefective: props.effects.maleCrossingDefective ?? false,
    femaleCrossingDefective: props.effects.femaleCrossingDefective ?? false,
    selfCrossingDefective: props.effects.selfCrossingDefective ?? false,
    him: props.effects.him ?? false,
  };
  const disabled = props.disabled === true;
  const count = CROSSING_EFFECT_OPTIONS.filter(
    ({ key }) => effects[key]
  ).length;
  return (
    <div className='dropdown dropdown-end'>
      {/* a label, not a button: Safari/WebKit does not focus a clicked button, which a daisyUI dropdown needs */}
      <label
        tabIndex={disabled ? -1 : 0}
        role='button'
        aria-disabled={disabled}
        className={`btn btn-outline btn-sm gap-1 normal-case ${
          disabled ? 'btn-disabled' : ''
        }`}
      >
        Crossing Effects
        {count > 0 && (
          <span className='badge badge-primary badge-sm'>{count}</span>
        )}
      </label>
      {!disabled && (
        <div
          tabIndex={0}
          className='dropdown-content rounded-box z-50 w-72 bg-base-100 p-2 shadow'
        >
          {CROSSING_EFFECT_OPTIONS.map(({ key, label }) => (
            <label
              key={key}
              className='label cursor-pointer justify-start gap-2'
            >
              <input
                type='checkbox'
                className='checkbox checkbox-sm'
                checked={effects[key]}
                onChange={(e) => {
                  props.onChange({ ...effects, [key]: e.target.checked });
                }}
              />
              <span className='label-text'>{label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

export default CrossingEffectsMenu;
