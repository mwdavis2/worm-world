import { fs } from '@tauri-apps/api';
import { toPng, toSvg } from 'html-to-image';
import { BsCardImage } from 'react-icons/bs';
import { FaPlus, FaMinus } from 'react-icons/fa6';
import { SiMicrogenetics as GeneIcon } from 'react-icons/si';
import { toast } from 'react-toastify';
import { type ReactFlowInstance, Controls, ControlButton } from 'reactflow';
import { save } from '@tauri-apps/api/dialog';
import { type Options } from 'html-to-image/lib/types';

interface CustomControlsProps {
  reactFlowInstance?: ReactFlowInstance;
  toggleGenes: () => void;
  crossDesignEditable: boolean;
}

const CustomControls = (props: CustomControlsProps): React.JSX.Element => {
  return (
    <Controls
      position='top-left'
      className='bg-base-100 text-base-content'
      showZoom={false}
      showInteractive={props.crossDesignEditable}
    >
      <ControlButton
        onClick={() => props.reactFlowInstance?.zoomIn({ duration: 150 })}
      >
        <FaPlus className='hover:cursor-pointer' />
      </ControlButton>
      <ControlButton
        onClick={() => props.reactFlowInstance?.zoomOut({ duration: 150 })}
      >
        <FaMinus className='hover:cursor-pointer' />
      </ControlButton>
      <ControlButton className='drowndown-hover dropdown'>
        <div>
          <label tabIndex={0} className=''>
            <BsCardImage className='text-3xl text-base-content hover:cursor-pointer' />
          </label>
          <ul
            tabIndex={0}
            className='menu dropdown-content rounded-box w-52 bg-base-100 p-2 shadow'
          >
            <li>
              <a
                target='_blank'
                onClick={() => {
                  saveImg('png');
                }}
              >
                Export to PNG
              </a>
            </li>
            <li>
              <a
                target='_blank'
                onClick={() => {
                  saveImg('svg');
                }}
              >
                Export to SVG
              </a>
            </li>
          </ul>
        </div>
      </ControlButton>
      <ControlButton onClick={props.toggleGenes}>
        <GeneIcon />
      </ControlButton>
    </Controls>
  );
};

type SaveMethod = 'png' | 'svg';
const saveMethodFuncs: Record<
  SaveMethod,
  (node: HTMLElement, options: Options) => Promise<string>
> = {
  png: toPng,
  svg: toSvg,
};

const downloadImage = async (
  strainUrl: string,
  saveMethod: SaveMethod,
  filePath: string | null,
  fallbackFilename: string
): Promise<void> => {
  // workaround because of this: https://github.com/tauri-apps/tauri/issues/4633
  if (window.__TAURI_IPC__ !== undefined) {
    if (filePath === null) {
      // user cancelled the save dialog
      return;
    }
    const strainBlob = await (await fetch(strainUrl)).blob();
    switch (saveMethod) {
      case 'png':
        fs.writeBinaryFile(filePath, await strainBlob.arrayBuffer())
          .then(() => toast.success('Exported PNG to ' + filePath))
          .catch(toast.error);
        break;
      case 'svg':
        fs.writeTextFile(filePath, await strainBlob.text())
          .then(() => toast.success('Exported SVG to ' + filePath))
          .catch(toast.error);
        break;
    }
  } else {
    const a = document.createElement('a');
    a.setAttribute('download', fallbackFilename);
    a.setAttribute('href', strainUrl);
    a.click();
  }
};

// Tauri's native dialog.save() presents a modal sheet on the app window; firing
// a second one before the first resolves leaves the extra sheet unresponsive
// to all input (macOS only tracks one active modal session per window).
let exportInProgress = false;

const saveImg = (saveMethod: SaveMethod): void => {
  if (exportInProgress) {
    toast.error('An export is already in progress');
    return;
  }
  const saveFunc = saveMethodFuncs[saveMethod];
  const reactFlowElem = document.querySelector('.react-flow');
  if (reactFlowElem === null) {
    alert('Could not find react-flow element');
    return;
  }
  exportInProgress = true;
  const filename = `cross-crossDesign-${new Date().toISOString()}.${saveMethod}`;
  Promise.all([
    save({
      defaultPath: filename,
      filters: [{ name: saveMethod.toUpperCase(), extensions: [saveMethod] }],
    }),
    saveFunc(reactFlowElem as HTMLElement, {
      width: 1920,
      height: 1080,
      quality: 1,
      skipAutoScale: false,
      pixelRatio: 1,
      filter: (node: Element | undefined) => {
        // we don't want to add the minimap and the controls to the image
        if (node === undefined) {
          return false;
        } else if (
          node.classList !== undefined &&
          (node.classList.contains('react-flow__minimap') ||
            node.classList.contains('react-flow__controls') ||
            node.classList.contains('react-flow__background') ||
            node.classList.contains('react-flow__attribution'))
        ) {
          return false;
        }
        return true;
      },
    }),
  ])
    .then(async ([filePath, strainUrl]) => {
      await downloadImage(strainUrl, saveMethod, filePath, filename);
    })
    .catch((e) => {
      alert(e);
    })
    .finally(() => {
      exportInProgress = false;
    });
};

export default CustomControls;
