import { type db_Strain } from 'models/db/db_Strain';

export interface ReplaceStrainDialogProps {
  /** The saved strain that already has the name; the dialog is shown while set */
  existing: db_Strain | undefined;
  onReplace: () => void;
  onCancel: () => void;
}

/**
 * Asks before a save overwrites a saved strain of the same name. The saved
 * strain's alleles and description are replaced; cards already in designs keep
 * their own copy.
 */
const ReplaceStrainDialog = (
  props: ReplaceStrainDialogProps
): React.JSX.Element => {
  if (props.existing === undefined) return <></>;
  return (
    <div className='modal modal-open' data-testid='replace-strain-dialog'>
      <div className='modal-box'>
        <h3 className='text-lg font-bold'>Replace the saved strain?</h3>
        <p className='py-4'>
          A strain named <strong>{props.existing.name}</strong> is already saved
          {props.existing.genotype !== '' && ` (${props.existing.genotype})`}.
          Saving replaces its alleles
          {props.existing.description !== null && ' and description'} with this
          strain&apos;s.
        </p>
        <p className='text-sm opacity-70'>
          Cards already in your designs keep the strain they were made with.
        </p>
        <div className='modal-action'>
          <button className='btn' onClick={props.onCancel}>
            Cancel
          </button>
          <button className='btn btn-primary' onClick={props.onReplace}>
            Replace
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReplaceStrainDialog;
