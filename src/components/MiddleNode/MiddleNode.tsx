import {
  HiFilter as FilterIcon,
  HiOutlineFilter as OutlineFilterIcon,
} from 'react-icons/hi';
import { AiOutlineEyeInvisible as EyeIcon } from 'react-icons/ai';
import type StrainFilter from 'models/frontend/StrainFilter/StrainFilter';
import { TbArrowLoopLeft as SelfIcon } from 'react-icons/tb';
import { Handle, Position, useStore } from 'reactflow';
import { BiX as CloseIcon } from 'react-icons/bi';
import { NodeType } from 'models/enums';

export interface MiddleNodeProps {
  id: string;
  data: StrainFilter;
  type: string;
}

const MiddleNode = (props: MiddleNodeProps): React.JSX.Element => {
  // The eye icon reflects whether any child is actually hidden, not just
  // whether a filter is set: the default viability filter hides lethal
  // children without the filter looking "set" (see StrainFilter.isEmpty).
  const hiddenChildCount = useStore(
    (state) =>
      [...state.nodeInternals.values()].filter(
        (node) => node.parentNode === props.id && node.hidden === true
      ).length
  );
  const filterSummary = props.data.describe();
  if (filterSummary.length === 0) filterSummary.push('No filters');
  return (
    // Sized to span both the circle and the icons above/right of it, so the
    // hoverable area that keeps the icons visible has no gap between them -
    // previously this wrapper's own box was only as big as the circle (the
    // icons are absolutely positioned outside it), so moving the mouse from
    // the circle toward an icon crossed space outside the hover target and
    // hid it again before it could be reached. The circle itself stays
    // pinned at its original visual position (bottom-left of this box).
    <div className='group relative h-20 w-36'>
      <div className='middle-node absolute bottom-0 left-0'>
        {props.type === NodeType.Self ? (
          <Handle key='top' id='top' type='target' position={Position.Top} />
        ) : (
          <>
            <Handle
              key='left'
              id='left'
              type='target'
              position={Position.Left}
            />
            <Handle
              key='right'
              id='right'
              type='target'
              position={Position.Right}
            />
          </>
        )}
        <Handle
          key='bottom'
          id='bottom'
          type='source'
          position={Position.Bottom}
        />
        <div
          className={`h-16 w-16 rounded-full p-4 transition hover:cursor-grab ${
            props.type === NodeType.Self ? 'bg-secondary' : 'bg-primary'
          }`}
        >
          {props.type === NodeType.Self ? (
            <SelfIcon className='h-8 w-8 text-3xl text-primary-content' />
          ) : (
            <CloseIcon className='h-8 w-8 text-3xl text-primary-content' />
          )}
        </div>
      </div>
      <div
        className={`export-hide-icon tooltip tooltip-top absolute left-24 top-0 ${
          hiddenChildCount > 0 ? '' : 'invisible'
        }`}
        data-tip={`${hiddenChildCount} strain${
          hiddenChildCount === 1 ? '' : 's'
        } hidden`}
      >
        <label
          htmlFor={`filtered-out-modal-${props.id}`}
          className='hover:cursor-pointer'
        >
          <EyeIcon size='30' />
        </label>
      </div>
      <div
        // before:whitespace-pre-line: daisyUI draws the tooltip text from
        // data-tip, where newlines would otherwise collapse - this keeps one
        // active filter per line.
        className={`export-hide-icon tooltip tooltip-top absolute left-16 top-0 before:whitespace-pre-line ${
          props.data.isEmpty() ? 'invisible group-hover:visible' : ''
        }`}
        data-tip={filterSummary.join('\n')}
      >
        <label
          htmlFor={`strain-filter-modal-${props.id}`}
          className='hover:cursor-pointer'
        >
          {props.data.isEmpty() ? (
            <OutlineFilterIcon size='30' />
          ) : (
            <FilterIcon size='30' />
          )}
        </label>
      </div>
    </div>
  );
};

export default MiddleNode;
