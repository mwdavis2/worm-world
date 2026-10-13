import StrainCard from 'components/StrainCard/StrainCard';
import { Sex } from 'models/enums';
import { type Strain } from 'models/frontend/Strain/Strain';
import {
  blockedHandleTitle,
  isCrossingBlocked,
} from 'models/frontend/Strain/crossingEffects';
import { getPreferences } from 'utils/preferences';
import { memo, useState } from 'react';
import { Handle, Position } from 'reactflow';

export const STRAIN_NODE_WIDTH = 256; // w-64
export const STRAIN_NODE_HEIGHT = 144; // w-36

export interface StrainNodeProps {
  data: Strain;
  id: string;
  xPos: number;
  yPos: number;
  selected?: boolean;
}

const StrainNode = memo((props: StrainNodeProps): React.JSX.Element => {
  const isHerm = props.data.sex === Sex.Hermaphrodite;
  const bRStyling = isHerm ? '' : 'invisible';
  const lStyling = isHerm ? 'invisible' : '';
  // A phenotype can make the right (female), bottom (self) or left (male)
  // rectangle unusable: it turns black and cannot start or take a connection.
  // The settings toggle can force crosses; it is read once, since changing it
  // happens on the Settings page, away from the editor.
  const [ignore] = useState(() => getPreferences().ignoreCrossingEffects);
  const blockedRight =
    isHerm && isCrossingBlocked(props.data, 'female', ignore);
  const blockedBottom = isHerm && isCrossingBlocked(props.data, 'self', ignore);
  const blockedLeft = !isHerm && isCrossingBlocked(props.data, 'male', ignore);
  const blocked = (is: boolean): string => (is ? ' crossing-blocked' : '');

  return (
    <div
      className={`strain-node h-fit w-fit rounded-lg ${
        props.selected === true ? 'outline outline-4 outline-primary' : ''
      }`}
    >
      <Handle
        key='top'
        id='top'
        type='target'
        position={Position.Top}
        className='invisible'
      />
      <Handle
        key='right'
        id='right'
        className={bRStyling + blocked(blockedRight)}
        type='source'
        position={Position.Right}
        isConnectable={!blockedRight}
        title={blockedRight ? blockedHandleTitle('female') : undefined}
      />
      <Handle
        key='left'
        className={lStyling + blocked(blockedLeft)}
        id='left'
        type='source'
        position={Position.Left}
        isConnectable={!blockedLeft}
        title={blockedLeft ? blockedHandleTitle('male') : undefined}
      />
      <Handle
        key='bottom'
        className={bRStyling + blocked(blockedBottom)}
        id='bottom'
        type='source'
        position={Position.Bottom}
        isConnectable={!blockedBottom}
        title={blockedBottom ? blockedHandleTitle('self') : undefined}
      />
      <StrainCard strain={props.data} {...props} />
    </div>
  );
});
StrainNode.displayName = 'StrainNode';

export default StrainNode;
