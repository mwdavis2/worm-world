import { fs } from '@tauri-apps/api';
import { toPng } from 'html-to-image';
import { useEffect } from 'react';
import { BsCardImage } from 'react-icons/bs';
import { FaPlus, FaMinus, FaExpand, FaLock, FaLockOpen } from 'react-icons/fa6';
import { SiMicrogenetics as GeneIcon } from 'react-icons/si';
import { toast } from 'react-toastify';
import {
  type ReactFlowInstance,
  Controls,
  ControlButton,
  getRectOfNodes,
  useStore,
  useStoreApi,
} from 'reactflow';
import { save } from '@tauri-apps/api/dialog';
import { type EdgeStyle, type TextExportMode } from 'utils/preferences';
import { buildCrossDesignSvg } from 'utils/svgExport/svgExport';

interface CustomControlsProps {
  reactFlowInstance?: ReactFlowInstance;
  cycleAlleleDisplayMode: () => void;
  crossDesignEditable: boolean;
  edgeStyle: EdgeStyle;
  alleleDisplayMode: string;
  alleleDisplayLabel: string;
  textExportMode: TextExportMode;
}

// Each button gets a daisyUI tooltip to its right (the controls sit in the
// upper-left corner), like the hover tips elsewhere in the app. The flex classes
// keep react-flow's centered icon layout, which .tooltip's inline-block would
// otherwise override.
const TIP = 'tooltip tooltip-right flex items-center justify-center';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';

const CustomControls = (props: CustomControlsProps): React.JSX.Element => {
  // Cmd/Ctrl with plus, minus or zero works the zoom and fit-view buttons
  const { reactFlowInstance } = props;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (['+', '='].includes(event.key)) {
        event.preventDefault();
        reactFlowInstance?.zoomIn({ duration: 150 });
      } else if (['-', '_'].includes(event.key)) {
        event.preventDefault();
        reactFlowInstance?.zoomOut({ duration: 150 });
      } else if (event.key === '0') {
        event.preventDefault();
        reactFlowInstance?.fitView();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [reactFlowInstance]);

  // react-flow's own fit-view and lock buttons can't take a tooltip, so they are
  // rebuilt here: the lock is what react-flow's built-in one does.
  const store = useStoreApi();
  const isInteractive = useStore(
    (state) =>
      state.nodesDraggable || state.nodesConnectable || state.elementsSelectable
  );
  const toggleInteractive = (): void => {
    store.setState({
      nodesDraggable: !isInteractive,
      nodesConnectable: !isInteractive,
      elementsSelectable: !isInteractive,
    });
  };

  return (
    <Controls
      position='top-left'
      className='bg-base-100 text-base-content'
      showZoom={false}
      showFitView={false}
      showInteractive={false}
    >
      <ControlButton
        className={TIP}
        data-tip={`Fit view (${MOD}0)`}
        onClick={() => props.reactFlowInstance?.fitView()}
      >
        <FaExpand className='hover:cursor-pointer' />
      </ControlButton>
      {props.crossDesignEditable && (
        <ControlButton
          className={TIP}
          data-tip={isInteractive ? 'Lock the canvas' : 'Unlock the canvas'}
          onClick={toggleInteractive}
        >
          {isInteractive ? (
            <FaLockOpen className='hover:cursor-pointer' />
          ) : (
            <FaLock className='hover:cursor-pointer' />
          )}
        </ControlButton>
      )}
      <ControlButton
        className={TIP}
        data-tip={`Zoom in (${MOD}+)`}
        onClick={() => props.reactFlowInstance?.zoomIn({ duration: 150 })}
      >
        <FaPlus className='hover:cursor-pointer' />
      </ControlButton>
      <ControlButton
        className={TIP}
        data-tip={`Zoom out (${MOD}-)`}
        onClick={() => props.reactFlowInstance?.zoomOut({ duration: 150 })}
      >
        <FaMinus className='hover:cursor-pointer' />
      </ControlButton>
      <ControlButton
        className='drowndown-hover dropdown tooltip tooltip-right'
        data-tip='Export image'
      >
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
                  saveImg(
                    'png',
                    props.reactFlowInstance,
                    props.edgeStyle,
                    props.alleleDisplayMode,
                    props.textExportMode
                  );
                  // This is a CSS/focus-driven daisyUI dropdown (tabIndex +
                  // :focus-within), not React state - it only closes when
                  // the focused label loses focus, which a click on an item
                  // inside it never triggers on its own.
                  (document.activeElement as HTMLElement | null)?.blur();
                }}
              >
                Export to PNG
              </a>
            </li>
            <li>
              <a
                target='_blank'
                onClick={() => {
                  saveImg(
                    'svg',
                    props.reactFlowInstance,
                    props.edgeStyle,
                    props.alleleDisplayMode,
                    props.textExportMode
                  );
                  (document.activeElement as HTMLElement | null)?.blur();
                }}
              >
                Export to SVG
              </a>
            </li>
          </ul>
        </div>
      </ControlButton>
      <ControlButton
        className={TIP}
        data-tip={`Allele labels: ${props.alleleDisplayLabel} (click to change)`}
        onClick={props.cycleAlleleDisplayMode}
      >
        <GeneIcon />
      </ControlButton>
    </Controls>
  );
};

type SaveMethod = 'png' | 'svg';

// SVG export is hand-built directly from the cross design's data
// (buildCrossDesignSvg) rather than converting the DOM - two DOM-conversion
// libraries were tried (html-to-image's foreignObject-based SVG, then
// dom-to-svg) and neither reliably reproduced this app's text/edges/icons in
// Illustrator or Inkscape. A data-driven exporter has no such dependency.
const exportSvg = async (
  reactFlowInstance: ReactFlowInstance,
  edgeStyle: EdgeStyle,
  alleleDisplayMode: string,
  textExportMode: TextExportMode
): Promise<string> => {
  const svgString = await buildCrossDesignSvg(
    reactFlowInstance.getNodes(),
    reactFlowInstance.getEdges(),
    edgeStyle,
    alleleDisplayMode,
    textExportMode
  );
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`;
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

// Padding (in unscaled graph pixels) around the graph's bounding box in the
// exported image.
const EXPORT_PADDING = 50;

const saveImg = (
  saveMethod: SaveMethod,
  reactFlowInstance: ReactFlowInstance | undefined,
  edgeStyle: EdgeStyle,
  alleleDisplayMode: string,
  textExportMode: TextExportMode
): void => {
  if (exportInProgress) {
    toast.error('An export is already in progress');
    return;
  }
  if (reactFlowInstance === undefined) {
    alert('Could not find react-flow instance');
    return;
  }
  // Capture the viewport (nodes/edges only) rather than the whole .react-flow
  // container - the minimap/controls/background/attribution are siblings of
  // the viewport, not descendants, so this excludes them by DOM structure
  // alone. Capturing the whole container instead just clones whatever's
  // currently rendered under the live pan/zoom transform, which is why the
  // export used to only capture whatever was in view at click time.
  const viewportElem = document.querySelector('.react-flow__viewport');
  if (viewportElem === null) {
    alert('Could not find react-flow viewport element');
    return;
  }
  // Cards' shadows are subtle against the app's own gray dotted canvas
  // (.react-flow__background), but since that's excluded from the capture
  // (it's a sibling of the viewport, not a descendant), match its actual
  // theme color here rather than defaulting to white - otherwise the same
  // shadow looks like a much more prominent halo once isolated on white.
  const backgroundElem = document.querySelector('.react-flow__background');
  const backgroundColor =
    backgroundElem !== null
      ? getComputedStyle(backgroundElem).backgroundColor
      : '#ffffff';
  exportInProgress = true;
  const filename = `cross-crossDesign-${new Date().toISOString()}.${saveMethod}`;

  // Size the output to the graph itself at a fixed 1:1 scale (plus padding),
  // rather than squeezing a variable-sized graph into fixed image dimensions
  // - that would make the effective detail per node depend on how large the
  // graph happens to be. pixelRatio below is the actual "resolution" lever.
  const nodesBounds = getRectOfNodes(reactFlowInstance.getNodes());
  const outputWidth = nodesBounds.width + EXPORT_PADDING * 2;
  const outputHeight = nodesBounds.height + EXPORT_PADDING * 2;
  const x = EXPORT_PADDING - nodesBounds.x;
  const y = EXPORT_PADDING - nodesBounds.y;

  // Drop shadows and handles for the export only - they're on-screen
  // depth/interaction cues that don't belong in a static image. Toggled on
  // the live DOM (not just the clone) since html-to-image serializes
  // computed styles as they are at capture time.
  viewportElem.classList.add('exporting-cross-design');

  const imagePromise: Promise<string> =
    saveMethod === 'png'
      ? toPng(viewportElem as HTMLElement, {
          width: outputWidth,
          height: outputHeight,
          quality: 1,
          skipAutoScale: false,
          pixelRatio: 2,
          backgroundColor,
          style: {
            width: `${outputWidth}px`,
            height: `${outputHeight}px`,
            transform: `translate(${x}px, ${y}px) scale(1)`,
          },
        })
      : exportSvg(
          reactFlowInstance,
          edgeStyle,
          alleleDisplayMode,
          textExportMode
        );

  Promise.all([
    save({
      defaultPath: filename,
      filters: [{ name: saveMethod.toUpperCase(), extensions: [saveMethod] }],
    }),
    imagePromise,
  ])
    .then(async ([filePath, strainUrl]) => {
      await downloadImage(strainUrl, saveMethod, filePath, filename);
    })
    .catch((e) => {
      alert(e);
    })
    .finally(() => {
      viewportElem.classList.remove('exporting-cross-design');
      exportInProgress = false;
    });
};

export default CustomControls;
