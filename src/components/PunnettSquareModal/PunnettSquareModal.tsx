import { useEffect, useMemo, useRef, useState } from 'react';
import { IoMale as MaleIcon, IoMaleFemale as HermIcon } from 'react-icons/io5';
import { Sex } from 'models/enums';
import {
  MAX_PUNNETT_GAMETES,
  type Gamete,
  type PunnettSquare,
  type Strain,
} from 'models/frontend/Strain/Strain';
import { gameteLabel } from 'models/frontend/Strain/gameteLabel';
import {
  groupPunnettCells,
  type CellGroup,
  type CellGroups,
} from './punnettGroups';

/** What the cross feeds a Punnett square; the father is undefined for a self cross. */
export interface PunnettInputs {
  mother: Strain;
  father?: Strain;
  motherPhenotypes: ReadonlySet<string>;
  fatherPhenotypes?: ReadonlySet<string>;
  activeConditions: Set<string>;
  himNulloFraction: number;
}

interface PunnettSquareModalProps {
  filterId: string;
  // Read when the modal opens, so the grid is only worked out for a cross
  // someone asks about (the Editor mounts one of these for every cross).
  getInputs: () => PunnettInputs | undefined;
}

type Result =
  | PunnettSquare
  | { kind: 'none' }
  | { kind: 'error'; message: string };

const percent = (probability: number | undefined): string =>
  `${((probability ?? 0) * 100).toFixed(2)}%`;

const GameteHeader = (props: { gamete: Gamete }): React.JSX.Element => (
  <>
    <div className='font-medium'>
      {gameteLabel(props.gamete) === '' ? '+' : gameteLabel(props.gamete)}
    </div>
    <div className='text-xs font-normal opacity-70'>
      {percent(props.gamete.prob)}
    </div>
  </>
);

/** What is being hovered: every cell in the same genotype or phenotype group lights up */
type Hover = { kind: 'genotype' | 'phenotype'; id: number } | undefined;

/** The event handlers that make a piece of cell text a hover (and keyboard focus) target */
interface HoverHandlers {
  tabIndex: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
}

const groupLine = (group: CellGroup): string =>
  `${group.count} cell${group.count === 1 ? '' : 's'} · ${percent(
    group.probability
  )}`;

const PunnettCell = (props: {
  cell?: Strain;
  groups?: CellGroups;
  hover: Hover;
  setHover: (hover: Hover) => void;
}): React.JSX.Element => {
  const { cell, groups, hover, setHover } = props;
  if (cell === undefined || groups === undefined)
    return (
      <td className='border border-base-300 text-center text-xs opacity-50'>
        no worm
      </td>
    );
  const lit = hover !== undefined && groups[hover.kind].id === hover.id;
  const hoverProps = (
    kind: 'genotype' | 'phenotype',
    group: CellGroup
  ): HoverHandlers => ({
    tabIndex: 0,
    onMouseEnter: () => {
      setHover({ kind, id: group.id });
    },
    onMouseLeave: () => {
      setHover(undefined);
    },
    onFocus: () => {
      setHover({ kind, id: group.id });
    },
    onBlur: () => {
      setHover(undefined);
    },
  });
  return (
    <td
      data-lit={lit}
      className={`border border-base-300 align-top ${
        lit
          ? 'bg-primary/30 ring-2 ring-inset ring-primary'
          : cell.lethal === true
          ? 'bg-error/20'
          : ''
      }`}
    >
      <div className='text-xs opacity-70'>{percent(cell.probability)}</div>
      <div
        className='cursor-default rounded px-1 hover:bg-base-300'
        {...hoverProps('genotype', groups.genotype)}
      >
        <div className='flex items-center gap-1 text-sm'>
          {cell.sex === Sex.Male ? (
            <MaleIcon aria-label='male' />
          ) : (
            <HermIcon aria-label='hermaphrodite' />
          )}
          <span>{groups.genotype.label}</span>
        </div>
        <div className='text-xs opacity-70'>{groupLine(groups.genotype)}</div>
      </div>
      <div
        className='mt-1 cursor-default rounded px-1 hover:bg-base-300'
        {...hoverProps('phenotype', groups.phenotype)}
      >
        <div className='text-xs'>{groups.phenotype.label}</div>
        <div className='text-xs opacity-70'>{groupLine(groups.phenotype)}</div>
      </div>
      {cell.lethal === true && (
        <span className='badge badge-error badge-sm'>Lethal</span>
      )}
    </td>
  );
};

const PunnettSquareModal = (
  props: PunnettSquareModalProps
): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<Result | undefined>();
  const [title, setTitle] = useState('');
  const [hover, setHover] = useState<Hover>(undefined);
  const getInputs = useRef(props.getInputs);
  getInputs.current = props.getInputs;

  useEffect(() => {
    if (!open) {
      setResult(undefined);
      setHover(undefined);
      return;
    }
    let cancelled = false;
    const inputs = getInputs.current();
    if (inputs === undefined) {
      setResult({ kind: 'none' });
      return;
    }
    const { mother, father } = inputs;
    setTitle(
      father === undefined
        ? `${mother.genotype} selfed`
        : `${mother.genotype} × ${father.genotype}`
    );
    mother
      .punnett(father ?? mother, {
        thisPhenotypes: inputs.motherPhenotypes,
        otherPhenotypes: inputs.fatherPhenotypes ?? inputs.motherPhenotypes,
        himNulloFraction: inputs.himNulloFraction,
        activeConditions: inputs.activeConditions,
        motherPhenotypes: inputs.motherPhenotypes,
      })
      .then((square) => {
        if (!cancelled) setResult(square);
      })
      .catch((e) => {
        if (!cancelled)
          setResult({
            kind: 'error',
            message: e instanceof Error ? e.message : String(e),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const groups = useMemo(
    () =>
      result?.kind === 'grid' ? groupPunnettCells(result.cells) : undefined,
    [result]
  );

  const id = `punnett-modal-${props.filterId}`;
  return (
    <>
      <input
        type='checkbox'
        id={id}
        className='modal-toggle'
        checked={open}
        onChange={(e) => {
          setOpen(e.target.checked);
        }}
      />
      <label htmlFor={id} className='modal cursor-pointer'>
        <label className='modal-box w-auto max-w-5xl'>
          <div className='text-center text-2xl font-medium'>Punnett square</div>
          {title !== '' && result?.kind === 'grid' && (
            <div className='text-center text-sm opacity-70'>{title}</div>
          )}
          <div className='divider' />
          {result === undefined && <div className='text-center'>Working…</div>}
          {result?.kind === 'none' && (
            <div className='text-center'>
              This cross has no hermaphrodite parent to draw a square for.
            </div>
          )}
          {result?.kind === 'error' && (
            <div className='text-center text-error'>{result.message}</div>
          )}
          {result?.kind === 'tooMany' && (
            <div className='text-center'>
              {`Too many gametes to draw a square (${result.rows} × ${result.cols}; the most shown on a side is ${MAX_PUNNETT_GAMETES}).`}
            </div>
          )}
          {result?.kind === 'unsupported' && (
            <div className='text-center'>
              {result.reason === 'conversion'
                ? "A Punnett square isn't drawn for crosses where a germline conversion (Cre/lox) changes the gametes."
                : "A Punnett square isn't drawn for crosses with an extrachromosomal array that segregates."}
            </div>
          )}
          {result?.kind === 'grid' && (
            <div className='overflow-x-auto'>
              <table className='table-compact table m-auto'>
                <caption className='sr-only'>{title}</caption>
                <thead>
                  <tr>
                    <th className='border border-base-300 text-xs font-normal opacity-70'>
                      eggs ↓ · sperm →
                    </th>
                    {result.cols.map((col, idx) => (
                      <th
                        key={idx}
                        scope='col'
                        className='border border-base-300 bg-base-200 text-center'
                      >
                        <GameteHeader gamete={col} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, rowIdx) => (
                    <tr key={rowIdx}>
                      <th
                        scope='row'
                        className='border border-base-300 bg-base-200 text-center'
                      >
                        <GameteHeader gamete={row} />
                      </th>
                      {result.cells[rowIdx].map((cell, colIdx) => (
                        <PunnettCell
                          key={colIdx}
                          cell={cell}
                          groups={groups?.[rowIdx][colIdx]}
                          hover={hover}
                          setHover={setHover}
                        />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className='modal-action'>
            <label htmlFor={id} className='btn'>
              Close
            </label>
          </div>
        </label>
      </label>
    </>
  );
};

export default PunnettSquareModal;
