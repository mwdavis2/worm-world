import BreedCountProbability from 'components/BreedCountProbability/BreedCountProbability';
import EditorContext from 'components/EditorContext/EditorContext';
import { Menu } from 'components/Menu/Menu';
import StrainCardContext from 'components/StrainCardContext/StrainCardContext';
import { Sex } from 'models/enums';
import { type Allele } from 'models/frontend/Allele/Allele';
import { formatAlleleLabel } from 'models/frontend/Allele/alleleDisplay';
import { type AllelePair } from 'models/frontend/AllelePair/AllelePair';
import { getChromosomeLayout } from 'models/frontend/ChromosomePair/chromosomeLayout';
import { type ChromosomePair } from 'models/frontend/ChromosomePair/ChromosomePair';
import { type Strain } from 'models/frontend/Strain/Strain';
import { memo, useContext, useMemo, useRef } from 'react';
import { useFitScale } from 'hooks/useFitScale';
import { BsLightningCharge as MenuIcon } from 'react-icons/bs';
import { IoMale as MaleIcon, IoMaleFemale as HermIcon } from 'react-icons/io5';
import { RiArrowUpDownLine as SwapIcon } from 'react-icons/ri';

// Lethal cards: the normal card color with the theme's text color laid over it
// at 20%, so the card gets darker in light themes and lighter in dark ones
// (see LETHAL_CARD_MIX in utils/svgExport/theme.ts, which the export mirrors).
// An opaque gradient layer rather than color-mix(), which older macOS WebKit
// doesn't support.
const LETHAL_CARD_BACKGROUND =
  'bg-base-100 bg-[linear-gradient(hsl(var(--bc)/0.2),hsl(var(--bc)/0.2))]';

interface StrainCardProps {
  strain: Strain;
  id: string;
  // Stretches the card to fill its container's width instead of the fixed
  // w-64 used for react-flow's grid-positioned cross-design nodes. For
  // standalone previews (e.g. AddStrainModal) where there's no grid to align
  // with and the fixed width leaves the surrounding space unused.
  wide?: boolean;
}

const StrainCard = memo((props: StrainCardProps): JSX.Element => {
  const { ref: contentRef, scale: contentScale } = useFitScale<HTMLDivElement>([
    props.strain,
  ]);
  const probability =
    props.strain.probability === undefined
      ? 'No Prob'
      : `${(props.strain.probability * 100).toFixed(2)}%`;
  // Only set when a sibling from the same cross is currently filtered out -
  // otherwise it'd just duplicate `probability` above.
  const filteredProbability =
    props.strain.filteredProbability === undefined
      ? undefined
      : `${(props.strain.filteredProbability * 100).toFixed(2)}% shown`;

  const context = useContext(EditorContext);
  const menuItems = context.getMenuItems?.(props.id) ?? [];
  const menuRef = useRef<HTMLDivElement>(null);

  const strainCardContextValue = useMemo(
    () => ({
      strain: props.strain,
      toggleHetPair:
        context.toggleHetPair === undefined
          ? undefined
          : (pair: AllelePair) => {
              context.toggleHetPair?.(props.id, pair);
            },
      toggleSex:
        context.toggleSex === undefined
          ? undefined
          : () => {
              context.toggleSex?.(props.id);
            },
      alleleDisplayMode: context.alleleDisplayMode,
    }),
    [
      props.strain,
      props.id,
      context.toggleHetPair,
      context.toggleSex,
      context.alleleDisplayMode,
    ]
  );

  return (
    <StrainCardContext.Provider value={strainCardContextValue}>
      <div
        data-testid='strainCard'
        onContextMenu={(e) => {
          // Right-click opens the same Actions menu as the lightning icon
          if (menuItems.length === 0) return;
          e.preventDefault();
          menuRef.current?.querySelector('label')?.focus();
        }}
        className={`flex h-36 flex-col rounded shadow-md ${
          props.strain.lethal === true ? LETHAL_CARD_BACKGROUND : 'bg-base-100'
        } ${props.wide === true ? 'w-full' : 'w-64'}`}
      >
        <div className='flex h-6 justify-between'>
          <SexButton />
          {props.strain.isChild && (
            <div className={'dropdown justify-self-center' + ' dropdown-top'}>
              <label
                tabIndex={0}
                className='btn btn-ghost btn-xs text-accent ring-0 hover:bg-base-200 hover:ring-0'
              >
                {probability}
              </label>
              <div
                tabIndex={0}
                className='card-body dropdown-content rounded-box z-10 m-auto bg-base-100 shadow'
              >
                <BreedCountProbability probability={props.strain.probability} />
              </div>
            </div>
          )}
          {filteredProbability !== undefined && (
            <div className='self-center text-xs text-base-content/80'>
              {filteredProbability}
            </div>
          )}
          <div
            ref={menuRef}
            className={`${menuItems.length === 0 ? 'invisible' : ''}`}
          >
            <Menu
              title='Actions'
              top={true}
              icon={<MenuIcon />}
              items={menuItems}
            />
          </div>
        </div>
        <div className='min-w-0 overflow-hidden'>
          <div
            ref={contentRef}
            className='flex h-[82px] min-w-min justify-center text-sm'
            style={{
              transform: `scale(${contentScale})`,
              transformOrigin: 'top left',
            }}
          >
            <MainContentArea strain={props.strain} />
          </div>
        </div>
        <ViabilityLine strain={props.strain} />
        <div className='h-6 text-center font-bold'>{props.strain.name}</div>
      </div>
    </StrainCardContext.Provider>
  );
});
StrainCard.displayName = 'StrainCard';

// What this genotype expresses: its non-wild phenotypes, plus Lethal if it is.
// Always renders (empty if there's nothing to show) so every card keeps the
// same fixed height.
const ViabilityLine = (props: { strain: Strain }): React.JSX.Element => {
  const names = props.strain.exprPhenotypeNames ?? [];
  const lethal = props.strain.lethal === true;
  const title = [...names, ...(lethal ? ['Lethal'] : [])].join(' · ');
  return (
    <div
      className='h-[14px] truncate px-2 text-center text-[11px] leading-[14px]'
      title={title}
      data-testid='strainCardViability'
    >
      {names.join(', ')}
      {names.length > 0 && lethal && ' · '}
      {lethal && <span className='font-bold'>Lethal</span>}
    </div>
  );
};

const SexButton = (): React.JSX.Element => {
  const context = useContext(StrainCardContext);
  const buttonIsDisabled =
    context.strain.isParent || context.toggleSex === undefined;
  const iconStyling =
    'text-base ' + (context.strain.isParent ? 'opacity-50' : '');
  return (
    <button
      className={
        'btn btn-ghost btn-xs m-1 ring-0 hover:bg-base-200 hover:ring-0' +
        (buttonIsDisabled
          ? ' btn-transparent hover:cursor-default hover:bg-transparent'
          : '')
      }
      onClick={() => {
        if (!context.strain.isParent && context.toggleSex !== undefined) {
          context.toggleSex();
        }
      }}
    >
      {context.strain.sex === Sex.Male && <MaleIcon className={iconStyling} />}
      {context.strain.sex === Sex.Hermaphrodite && (
        <HermIcon className={iconStyling} />
      )}
    </button>
  );
};

// Return the main content area of the strain node, which will show genotype information
const MainContentArea = (props: { strain: Strain }): React.JSX.Element => {
  return props.strain.isEmptyWild() ? (
    <div className='flex flex-col items-center justify-center'>Wild type</div>
  ) : (
    <>
      {Array.from(props.strain.getSortedChromPairs())
        .filter((chromPair) => !(chromPair.isEca() && chromPair.isWild()))
        .map((chromPair, idx, chromPairs) => {
          return (
            <div key={idx} className='flex'>
              <ChromPairBox chromPair={chromPair} />
              <div className='flex flex-col justify-center pt-2 font-light text-base-content'>
                {idx < chromPairs.length - 1 ? ';' : ''}
              </div>
            </div>
          );
        })}
    </>
  );
};

// All the 'fractions' under a single chromosome
const ChromPairBox = (props: {
  chromPair: ChromosomePair;
}): React.JSX.Element => {
  const context = useContext(StrainCardContext);
  const layout = getChromosomeLayout(props.chromPair);
  const pairItems = layout.filter((item) => item.kind === 'pair');
  const mutationBoxes = layout.map((item, itemIdx) => {
    // A rearrangement's region is marked with a bracket pair in the gaps
    // between columns, level with the rule - like the ';' between chromosomes.
    if (item.kind !== 'pair')
      return (
        <div
          key={itemIdx}
          className='flex flex-col justify-center text-4xl font-normal leading-none text-base-content'
        >
          {item.kind === 'open' ? '[' : ']'}
        </div>
      );
    const allelePair = item.pair;
    // The first displayed column is the phase reference, so it has no toggle.
    const toggleEnabled =
      !context.strain.isParent &&
      !context.strain.isChild &&
      !allelePair.isHomo() &&
      pairItems.indexOf(item) !== 0;
    return (
      <MutationBox
        allelePair={allelePair}
        key={itemIdx}
        toggleEnabled={toggleEnabled}
        isX={props.chromPair.isX()}
      />
    );
  });
  const chromName = props.chromPair.getChromName() ?? '?';

  return (
    <div
      key={chromName}
      className='mx-2 flex flex-col items-center justify-start text-lg'
    >
      <div className='font-bold'>{chromName}</div>
      <div className='my-auto flex flex-row'>{mutationBoxes}</div>
    </div>
  );
};

// The untruncated label, for a hover tooltip - only set when truncating
// actually cut something.
const fullLabel = (
  allele: Allele,
  modeId: string,
  partner?: Allele
): string | undefined => {
  const full = formatAlleleLabel(allele, modeId, false, partner);
  return full === formatAlleleLabel(allele, modeId, true, partner)
    ? undefined
    : full;
};

// An empty label (e.g. the wild copy of a rearrangement homozygote) still has to hold its
// line, or the rule between the two rows would shift.
const cellText = (label: string): string => (label === '' ? '\u00A0' : label);

const MutationBox = (props: {
  allelePair: AllelePair;
  toggleEnabled: boolean;
  isX: boolean;
}): React.JSX.Element => {
  const context = useContext(StrainCardContext);

  if (props.allelePair.isEca())
    return props.allelePair.isWild() ? (
      <></>
    ) : (
      <div
        className='text-align w-full px-2 text-center'
        title={fullLabel(props.allelePair.top, context.alleleDisplayMode)}
      >
        {formatAlleleLabel(props.allelePair.top, context.alleleDisplayMode)}
      </div>
    );
  else {
    const hiddenStyling = props.toggleEnabled
      ? `visible group-hover:invisible`
      : '';

    return (
      <div className={`group relative flex flex-col whitespace-nowrap text-lg`}>
        {props.toggleEnabled && (
          <div
            className={`invisible absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-primary hover:cursor-pointer group-hover:visible `}
            onClick={() => {
              context.toggleHetPair?.(props.allelePair);
            }}
          >
            <SwapIcon />
          </div>
        )}
        <div
          className='text-align w-full px-2 text-center'
          title={fullLabel(
            props.allelePair.top,
            context.alleleDisplayMode,
            props.allelePair.bot
          )}
        >
          {cellText(
            formatAlleleLabel(
              props.allelePair.top,
              context.alleleDisplayMode,
              true,
              props.allelePair.bot
            )
          )}
        </div>
        <hr className={`border-base-content ${hiddenStyling}`} />
        <div
          className='text-align w-full px-2 text-center'
          title={
            context.strain.sex === Sex.Male && props.isX
              ? undefined
              : fullLabel(
                  props.allelePair.bot,
                  context.alleleDisplayMode,
                  props.allelePair.top
                )
          }
        >
          {context.strain.sex === Sex.Male && props.isX
            ? '0'
            : cellText(
                formatAlleleLabel(
                  props.allelePair.bot,
                  context.alleleDisplayMode,
                  true,
                  props.allelePair.top
                )
              )}
        </div>
      </div>
    );
  }
};

export default StrainCard;
