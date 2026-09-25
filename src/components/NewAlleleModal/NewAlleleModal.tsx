import { getFilteredConditions } from 'api/condition';
import {
  deleteVariation,
  getLocationReferenceVariations,
  insertVariation,
} from 'api/variation';
import { insertAllele } from 'api/allele';
import PhenotypeRow from 'components/PhenotypeRow/PhenotypeRow';
import { GeneSearchInput } from 'components/GeneSearchInput/GeneSearchInput';
import { type db_Condition } from 'models/db/db_Condition';
import { type db_Variation } from 'models/db/db_Variation';
import { type ChromosomeName } from 'models/db/filter/db_ChromosomeName';
import { type ConditionFieldName } from 'models/db/filter/db_ConditionFieldName';
import { type FilterGroup } from 'models/db/filter/FilterGroup';
import { Dominance } from 'models/enums';
import { Allele } from 'models/frontend/Allele/Allele';
import { Variation } from 'models/frontend/Variation/Variation';
import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { interpolateGeneticLoc } from 'utils/geneticLocation';
import {
  type AlleleTab,
  type FluorescentMarkerState,
  type GeneTabState,
  type RescuesGeneState,
  type ResistantToDrugState,
  type VariationTabState,
  buildAlleleName,
  computeDominanceRows,
  computeFluorescentMarkerRows,
  computeRescuesGeneRows,
  computeResistantToDrugRows,
  defaultGeneTabState,
  defaultPhenotypeRow,
  defaultVariationTabState,
  parseInitialAlleleName,
} from 'components/NewAlleleModal/newAlleleTypes';

const CHROMOSOME_OPTIONS: ChromosomeName[] = [
  'I',
  'II',
  'III',
  'IV',
  'V',
  'X',
  'MtDNA',
];

interface NewAlleleModalProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  // Prefilled from AlleleMultiSelect's unmatched search text.
  initialName?: string;
  onCreated: (allele: Allele) => void;
}

// A live search-and-select for the "Resistant to Drug" drug name, sourced
// from the existing Conditions table - forked from the same search pattern
// as GeneSearchInput/StrainForm's StrainSelect.
const ConditionSearchInput = (props: {
  value?: string;
  onSelect: (name: string) => void;
}): React.JSX.Element => {
  const [searchRes, setSearchRes] = useState<db_Condition[]>([]);
  const [text, setText] = useState(props.value ?? '');
  const [searched, setSearched] = useState(false);

  const onInputChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const value = event.target.value;
    setText(value);
    if (value === '') {
      setSearchRes([]);
      setSearched(false);
      return;
    }
    const filter: FilterGroup<ConditionFieldName> = {
      filters: [[['Name', { Like: value }]]],
      orderBy: [],
    };
    getFilteredConditions(filter)
      .then((res) => {
        setSearchRes(res);
        setSearched(true);
      })
      .catch(console.error);
  };

  // Text that doesn't match the last-committed value hasn't actually been
  // selected yet - "Resistant to Drug" is strictly existing-Conditions-only,
  // same as the Gene picker, so unmatched typing needs to be surfaced rather
  // than silently accepted and later silently dropped.
  const isUnmatched = text !== '' && text !== (props.value ?? '');

  return (
    <div className='dropdown'>
      <input
        type='text'
        placeholder='Drug name'
        className='input input-bordered input-sm'
        onChange={onInputChange}
        value={text}
      />
      {searchRes.length === 0 ? (
        searched && isUnmatched ? (
          <div className='text-xs text-warning'>No matching condition</div>
        ) : (
          <></>
        )
      ) : (
        <ul className='dropdown-content menu rounded-box z-50 my-2 max-h-60 w-52 overflow-auto bg-base-100 p-2 shadow'>
          {searchRes.map((condition, idx) => (
            <li
              key={idx}
              tabIndex={0}
              onClick={() => {
                props.onSelect(condition.name);
                setText(condition.name);
                setSearchRes([]);
                setSearched(false);
              }}
            >
              <a>{condition.name}</a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const ResistantToDrugControl = (props: {
  state: ResistantToDrugState;
  onChange: (state: ResistantToDrugState) => void;
}): React.JSX.Element => {
  // Checking this only ever has an effect once a drug has actually been
  // picked - dim the label AND disable the checkbox itself until then, so
  // it's impossible to check a box that would do nothing.
  const hasEffect = (props.state.drugName ?? '') !== '';
  return (
    <div className='flex items-center gap-2'>
      <input
        type='checkbox'
        className='checkbox checkbox-sm'
        checked={props.state.enabled}
        disabled={!hasEffect}
        onChange={(e) => {
          props.onChange({ ...props.state, enabled: e.target.checked });
        }}
      />
      <span className={hasEffect ? '' : 'opacity-50'}>Resistant to Drug</span>
      <ConditionSearchInput
        value={props.state.drugName}
        onSelect={(drugName) => {
          props.onChange({ ...props.state, drugName });
        }}
      />
    </div>
  );
};

const RescuesGeneControl = (props: {
  state: RescuesGeneState;
  onChange: (state: RescuesGeneState) => void;
}): React.JSX.Element => {
  // Checking this only ever has an effect once a gene has actually been
  // picked - dim the label AND disable the checkbox itself until then, so
  // it's impossible to check a box that would do nothing.
  const hasEffect = props.state.gene !== undefined;
  return (
    <div className='flex items-center gap-2'>
      <input
        type='checkbox'
        className='checkbox checkbox-sm'
        checked={props.state.enabled}
        disabled={!hasEffect}
        onChange={(e) => {
          props.onChange({ ...props.state, enabled: e.target.checked });
        }}
      />
      <span className={hasEffect ? '' : 'opacity-50'}>Rescues gene</span>
      <div className='w-48'>
        <GeneSearchInput
          selectedGene={props.state.gene}
          placeholder='Gene name'
          onSelect={(gene) => {
            props.onChange({
              ...props.state,
              gene,
              geneName: gene.descName ?? gene.sysName,
            });
          }}
        />
      </div>
    </div>
  );
};

const FluorescentMarkerControl = (props: {
  state: FluorescentMarkerState;
  onChange: (state: FluorescentMarkerState) => void;
}): React.JSX.Element => {
  // Checking this only ever has an effect once a marker name has actually
  // been entered - dim the label AND disable the checkbox itself until
  // then, so it's impossible to check a box that would do nothing.
  const hasEffect = props.state.text !== '';
  return (
    <div className='flex items-center gap-2'>
      <input
        type='checkbox'
        className='checkbox checkbox-sm'
        checked={props.state.enabled}
        disabled={!hasEffect}
        onChange={(e) => {
          props.onChange({ ...props.state, enabled: e.target.checked });
        }}
      />
      <span className={hasEffect ? '' : 'opacity-50'}>
        Fluorescent marker(s)
      </span>
      <input
        type='text'
        className='input input-bordered input-sm'
        value={props.state.text}
        onChange={(e) => {
          const text = e.target.value;
          // If clearing the name un-does the only thing that made checking
          // this meaningful, un-check it too rather than leaving a checked
          // box that's about to become disabled and stuck.
          props.onChange({
            ...props.state,
            text,
            enabled: text === '' ? false : props.state.enabled,
          });
        }}
      />
      <label className='label cursor-pointer gap-1'>
        <span className='label-text'>2 copies brighter</span>
        <input
          type='checkbox'
          className='checkbox checkbox-sm'
          checked={props.state.twoCopiesBrighter}
          onChange={(e) => {
            props.onChange({
              ...props.state,
              twoCopiesBrighter: e.target.checked,
            });
          }}
        />
      </label>
    </div>
  );
};

const NewAlleleModal = (props: NewAlleleModalProps): React.JSX.Element => {
  const [activeTab, setActiveTab] = useState<AlleleTab>('gene');
  const [activeView, setActiveView] = useState<'basic' | 'advanced'>('basic');
  const [gene, setGene] = useState<GeneTabState>(defaultGeneTabState());
  const [tiSiIs, setTiSiIs] = useState<VariationTabState>(
    defaultVariationTabState()
  );
  const [ex, setEx] = useState<VariationTabState>(defaultVariationTabState());
  const [locationReferenceOptions, setLocationReferenceOptions] = useState<
    db_Variation[]
  >([]);

  useEffect(() => {
    if (!props.isOpen) return;
    setActiveView('basic');
    // Route the typed search text to whichever tab it actually names -
    // e.g. "oxEx100" belongs on the Ex tab, not the Gene tab's plain
    // designation field - and pre-fill that tab's prefix/type/suffix.
    const parsed = parseInitialAlleleName(props.initialName ?? '');
    setActiveTab(parsed.tab);
    setGene({
      ...defaultGeneTabState(),
      name: parsed.tab === 'gene' ? parsed.plainName ?? '' : '',
    });
    setTiSiIs(
      parsed.tab === 'tiSiIs'
        ? {
            ...defaultVariationTabState(),
            namePrefix: parsed.namePrefix ?? '',
            namingPrefix: parsed.namingPrefix,
            nameSuffix: parsed.nameSuffix ?? '',
          }
        : defaultVariationTabState()
    );
    setEx(
      parsed.tab === 'ex'
        ? {
            ...defaultVariationTabState(),
            namePrefix: parsed.namePrefix ?? '',
            nameSuffix: parsed.nameSuffix ?? '',
          }
        : defaultVariationTabState()
    );
    getLocationReferenceVariations()
      .then(setLocationReferenceOptions)
      .catch(console.error);
    // Only (re)initialize when the modal actually opens - not on every
    // keystroke while it's open.
  }, [props.isOpen, props.initialName]);

  // Recomputes every Basic-derived tagged row from the tab's current control
  // state, preserving manually-added/edited rows (derivedFrom undefined)
  // exactly as they are. Applied on every Basic control change so Advanced
  // shows an accurate live preview if the user peeks at it.
  const resyncGeneTab = (next: GeneTabState): GeneTabState => {
    const manual = next.phenotypeRows.filter(
      (row) => row.derivedFrom === undefined
    );
    const geneName = next.gene?.descName ?? next.gene?.sysName ?? '';
    return {
      ...next,
      phenotypeRows: [
        ...manual,
        ...computeResistantToDrugRows(next.resistantToDrug),
        ...computeRescuesGeneRows(next.rescuesGene),
        ...computeFluorescentMarkerRows(next.fluorescentMarker),
        ...computeDominanceRows(next.dominance, geneName),
      ],
    };
  };

  const resyncVariationTab = (next: VariationTabState): VariationTabState => {
    const manual = next.phenotypeRows.filter(
      (row) => row.derivedFrom === undefined
    );
    return {
      ...next,
      phenotypeRows: [
        ...manual,
        ...computeResistantToDrugRows(next.resistantToDrug),
        ...computeRescuesGeneRows(next.rescuesGene),
        ...computeFluorescentMarkerRows(next.fluorescentMarker),
      ],
    };
  };

  const updateGene = (updates: Partial<GeneTabState>): void => {
    setGene((prev) => resyncGeneTab({ ...prev, ...updates }));
  };

  const activeVariationTab = activeTab === 'ex' ? ex : tiSiIs;
  const setActiveVariationTab =
    activeTab === 'ex'
      ? (updates: Partial<VariationTabState>) => {
          setEx((prev) => resyncVariationTab({ ...prev, ...updates }));
        }
      : (updates: Partial<VariationTabState>) => {
          setTiSiIs((prev) => resyncVariationTab({ ...prev, ...updates }));
        };

  const close = (): void => {
    props.setIsOpen(false);
  };

  const handleCreate = (): void => {
    void (async (): Promise<void> => {
      try {
        let allele: Allele;
        if (activeTab === 'gene') {
          if (gene.gene === undefined) return;
          const rows =
            activeView === 'basic'
              ? resyncGeneTab(gene).phenotypeRows
              : gene.phenotypeRows;
          void rows; // held for the future #4/#11 wiring pass - not persisted yet
          allele = new Allele({
            name: gene.name,
            gene: gene.gene,
            contents: gene.qualifiers === '' ? undefined : gene.qualifiers,
          });
          await insertAllele(allele);
        } else {
          const tab = activeVariationTab;
          const rows =
            activeView === 'basic'
              ? resyncVariationTab(tab).phenotypeRows
              : tab.phenotypeRows;
          void rows; // held for the future #4/#11 wiring pass - not persisted yet

          const finalName = buildAlleleName(activeTab, tab);
          let geneticLoc =
            tab.positionMode === 'genetic' ? tab.positionValue : undefined;
          if (
            tab.positionMode === 'physical' &&
            geneticLoc === undefined &&
            tab.chromosome !== undefined &&
            tab.positionValue !== undefined
          ) {
            geneticLoc = await interpolateGeneticLoc(
              tab.chromosome,
              tab.positionValue
            );
          }
          const variation = new Variation({
            name: finalName,
            chromosome: tab.chromosome,
            physLoc:
              tab.positionMode === 'physical' ? tab.positionValue : undefined,
            geneticLoc,
            percentLoss: activeTab === 'ex' ? tab.percentLoss : undefined,
          });
          await insertVariation(variation);
          try {
            allele = new Allele({
              name: finalName,
              variation,
              contents: tab.qualifiers === '' ? undefined : tab.qualifiers,
            });
            await insertAllele(allele);
          } catch (e) {
            // Auto-delete the orphaned Variation if the Allele insert fails,
            // per explicit decision - no dangling Variation row with
            // nothing pointing at it.
            await deleteVariation(variation.generateRecord()).catch(
              console.error
            );
            throw e;
          }
        }
        props.onCreated(allele);
        close();
      } catch (e) {
        toast.error(
          'Unable to create allele. Make sure the name is not already in use.'
        );
      }
    })();
  };

  const canCreate =
    activeTab === 'gene'
      ? gene.name !== '' && gene.gene !== undefined
      : activeVariationTab.namePrefix !== '' &&
        activeVariationTab.nameSuffix !== '' &&
        // Chromosome only applies to Ti/Si/Is - Ex arrays aren't
        // chromosomally located, so there's no field to require here.
        (activeTab !== 'tiSiIs' || activeVariationTab.chromosome !== undefined);

  const selectLocationReference = (variation: db_Variation): void => {
    const hasPhys = variation.physLoc !== null;
    const hasGenetic = variation.geneticLoc !== null;
    const positionMode: 'physical' | 'genetic' =
      hasPhys || !hasGenetic ? 'physical' : 'genetic';
    const positionValue =
      positionMode === 'physical'
        ? variation.physLoc ?? undefined
        : variation.geneticLoc ?? undefined;
    setActiveVariationTab({
      chromosome: variation.chromosome ?? undefined,
      positionMode,
      positionValue,
    });
  };

  return (
    <>
      <input
        type='checkbox'
        className='modal-toggle'
        readOnly
        checked={props.isOpen}
      />
      <div className='modal'>
        <div className='modal-box max-w-3xl'>
          <h2 className='text-lg font-bold'>New Allele</h2>

          <div className='tabs tabs-boxed my-2 w-fit'>
            <button
              type='button'
              className={`tab ${activeTab === 'gene' ? 'tab-active' : ''}`}
              onClick={() => {
                setActiveTab('gene');
              }}
            >
              Gene
            </button>
            <button
              type='button'
              className={`tab ${activeTab === 'tiSiIs' ? 'tab-active' : ''}`}
              onClick={() => {
                setActiveTab('tiSiIs');
              }}
            >
              Ti/Si/Is
            </button>
            <button
              type='button'
              className={`tab ${activeTab === 'ex' ? 'tab-active' : ''}`}
              onClick={() => {
                setActiveTab('ex');
              }}
            >
              Ex
            </button>
          </div>

          <div className='my-2 flex items-end gap-4'>
            {activeTab === 'gene' ? (
              <div className='form-control'>
                <label className='label'>
                  <span className='label-text'>Allele</span>
                </label>
                <input
                  type='text'
                  aria-label='Allele name'
                  className='input input-bordered input-sm'
                  value={gene.name}
                  onChange={(e) => {
                    updateGene({ name: e.target.value });
                  }}
                />
              </div>
            ) : (
              <div className='form-control'>
                <label className='label'>
                  <span className='label-text'>Allele</span>
                </label>
                <div className='flex items-center gap-1'>
                  <input
                    type='text'
                    aria-label='Allele name prefix'
                    placeholder='prefix'
                    className='input input-bordered input-sm w-20'
                    value={activeVariationTab.namePrefix}
                    onChange={(e) => {
                      const value = e.target.value
                        .toLowerCase()
                        .replace(/[^a-z]/g, '');
                      setActiveVariationTab({ namePrefix: value });
                    }}
                  />
                  {activeTab === 'tiSiIs' ? (
                    <select
                      aria-label='Naming type'
                      className='select select-bordered select-sm'
                      value={activeVariationTab.namingPrefix}
                      onChange={(e) => {
                        const value = e.target.value as 'Ti' | 'Si' | 'Is';
                        setActiveVariationTab({ namingPrefix: value });
                      }}
                    >
                      <option value='Ti'>Ti</option>
                      <option value='Si'>Si</option>
                      <option value='Is'>Is</option>
                    </select>
                  ) : (
                    <span>Ex</span>
                  )}
                  <input
                    type='text'
                    aria-label='Allele name suffix'
                    placeholder='suffix'
                    className='input input-bordered input-sm w-24'
                    value={activeVariationTab.nameSuffix}
                    onChange={(e) => {
                      const value = e.target.value.replace(/[^0-9]/g, '');
                      setActiveVariationTab({ nameSuffix: value });
                    }}
                  />
                </div>
              </div>
            )}
            <div className='form-control'>
              <label className='label'>
                <span className='label-text'>Qualifiers</span>
              </label>
              <input
                type='text'
                className='input input-bordered input-sm'
                value={
                  activeTab === 'gene'
                    ? gene.qualifiers
                    : activeVariationTab.qualifiers
                }
                onChange={(e) => {
                  if (activeTab === 'gene')
                    updateGene({ qualifiers: e.target.value });
                  else setActiveVariationTab({ qualifiers: e.target.value });
                }}
              />
            </div>
          </div>

          {activeTab === 'gene' && (
            <div className='my-2'>
              <GeneSearchInput
                selectedGene={gene.gene}
                onSelect={(selectedGene) => {
                  updateGene({ gene: selectedGene });
                }}
              />
            </div>
          )}

          {activeTab === 'tiSiIs' && (
            <div className='my-2 flex flex-wrap items-end gap-2'>
              <div className='form-control'>
                <label className='label'>
                  <span className='label-text'>Chromosome</span>
                </label>
                <select
                  aria-label='Chromosome'
                  className='select select-bordered select-sm'
                  value={tiSiIs.chromosome ?? ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    setActiveVariationTab({
                      chromosome:
                        value === '' ? undefined : (value as ChromosomeName),
                    });
                  }}
                >
                  <option value=''>—</option>
                  {CHROMOSOME_OPTIONS.map((chrom) => (
                    <option key={chrom} value={chrom}>
                      {chrom}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type='button'
                className='btn btn-ghost btn-sm'
                onClick={() => {
                  setActiveVariationTab({
                    positionMode:
                      tiSiIs.positionMode === 'physical'
                        ? 'genetic'
                        : 'physical',
                  });
                }}
              >
                {tiSiIs.positionMode === 'physical'
                  ? 'Physical pos'
                  : 'Genetic pos'}
              </button>
              <input
                type='number'
                aria-label='Position value'
                className='input input-bordered input-sm w-32'
                value={tiSiIs.positionValue ?? ''}
                onChange={(e) => {
                  const value = e.target.value;
                  setActiveVariationTab({
                    positionValue: value === '' ? undefined : Number(value),
                  });
                }}
              />
              {locationReferenceOptions.length > 0 && (
                <select
                  className='select select-bordered select-sm'
                  value=''
                  onChange={(e) => {
                    const selected = locationReferenceOptions.find(
                      (v) => v.alleleName === e.target.value
                    );
                    if (selected !== undefined)
                      selectLocationReference(selected);
                  }}
                >
                  <option value=''>Location lookup</option>
                  {locationReferenceOptions.map((v) => (
                    <option key={v.alleleName} value={v.alleleName}>
                      {v.alleleName}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {activeTab === 'ex' && (
            <div className='form-control my-2 w-64'>
              <label className='label'>
                <span className='label-text'>% loss</span>
              </label>
              <input
                type='range'
                min={0}
                max={100}
                className='range range-sm'
                value={ex.percentLoss ?? 0}
                onChange={(e) => {
                  setActiveVariationTab({
                    percentLoss: Number(e.target.value),
                  });
                }}
              />
              <span className='text-sm'>{ex.percentLoss ?? 0}</span>
            </div>
          )}

          <div className='tabs my-2'>
            <button
              type='button'
              className={`tab tab-bordered ${
                activeView === 'basic' ? 'tab-active' : ''
              }`}
              onClick={() => {
                setActiveView('basic');
              }}
            >
              Basic
            </button>
            <button
              type='button'
              className={`tab tab-bordered ${
                activeView === 'advanced' ? 'tab-active' : ''
              }`}
              onClick={() => {
                setActiveView('advanced');
              }}
            >
              Advanced
            </button>
          </div>

          <h3 className='font-semibold'>Phenotypes</h3>
          {activeView === 'basic' ? (
            <div className='flex flex-col gap-2'>
              <ResistantToDrugControl
                key={`resistantToDrug-${activeTab}`}
                state={
                  activeTab === 'gene'
                    ? gene.resistantToDrug
                    : activeVariationTab.resistantToDrug
                }
                onChange={(state) => {
                  if (activeTab === 'gene')
                    updateGene({ resistantToDrug: state });
                  else setActiveVariationTab({ resistantToDrug: state });
                }}
              />
              {activeTab === 'gene' &&
                (() => {
                  // Checking this only ever has an effect once at least one
                  // zygosity box has a Phenotype name - dim the label AND
                  // disable the checkbox itself until then, so it's
                  // impossible to check a box that would do nothing.
                  const dominanceHasEffect =
                    computeDominanceRows(
                      { ...gene.dominance, enabled: true },
                      ''
                    ).length > 0;
                  return (
                    <div className='flex flex-col gap-2'>
                      <div className='flex items-center gap-2'>
                        <input
                          type='checkbox'
                          className='checkbox checkbox-sm'
                          checked={gene.dominance.enabled}
                          disabled={!dominanceHasEffect}
                          onChange={(e) => {
                            updateGene({
                              dominance: {
                                ...gene.dominance,
                                enabled: e.target.checked,
                              },
                            });
                          }}
                        />
                        <select
                          className={`select select-bordered select-sm ${
                            dominanceHasEffect ? '' : 'opacity-50'
                          }`}
                          aria-label='Dominance'
                          value={gene.dominance.mode}
                          onChange={(e) => {
                            updateGene({
                              dominance: {
                                ...gene.dominance,
                                mode: Number(e.target.value) as Dominance,
                              },
                            });
                          }}
                        >
                          {[
                            Dominance.Recessive,
                            Dominance.SemiDominant,
                            Dominance.Dominant,
                          ].map((mode) => (
                            <option key={mode} value={mode}>
                              {Dominance[mode]}
                            </option>
                          ))}
                        </select>
                        {gene.dominance.mode !== Dominance.SemiDominant && (
                          <div className='flex items-center gap-1'>
                            <span className='text-sm'>Phenotype</span>
                            <input
                              type='text'
                              placeholder='Name'
                              className='input input-bordered input-sm w-24'
                              value={gene.dominance.homozygous.name}
                              onChange={(e) => {
                                const homozygous = {
                                  ...gene.dominance.homozygous,
                                  name: e.target.value,
                                };
                                const nextDominance = {
                                  ...gene.dominance,
                                  homozygous,
                                };
                                const stillHasEffect =
                                  computeDominanceRows(
                                    { ...nextDominance, enabled: true },
                                    ''
                                  ).length > 0;
                                updateGene({
                                  dominance: {
                                    ...nextDominance,
                                    enabled: stillHasEffect
                                      ? gene.dominance.enabled
                                      : false,
                                  },
                                });
                              }}
                            />
                            <label className='label cursor-pointer gap-1'>
                              <span
                                className={`label-text ${
                                  gene.dominance.homozygous.name === ''
                                    ? 'opacity-50'
                                    : ''
                                }`}
                              >
                                rescued by WT
                              </span>
                              <input
                                type='checkbox'
                                className='checkbox checkbox-sm'
                                checked={gene.dominance.homozygous.rescuedByWT}
                                disabled={gene.dominance.homozygous.name === ''}
                                onChange={(e) => {
                                  updateGene({
                                    dominance: {
                                      ...gene.dominance,
                                      homozygous: {
                                        ...gene.dominance.homozygous,
                                        rescuedByWT: e.target.checked,
                                      },
                                    },
                                  });
                                }}
                              />
                            </label>
                          </div>
                        )}
                      </div>
                      {gene.dominance.mode === Dominance.SemiDominant && (
                        <div className='ml-8 flex flex-col gap-2'>
                          <div className='flex items-center gap-1'>
                            <span className='text-sm'>-/- Phenotype</span>
                            <input
                              type='text'
                              placeholder='Name'
                              className='input input-bordered input-sm w-24'
                              value={gene.dominance.homozygous.name}
                              onChange={(e) => {
                                const homozygous = {
                                  ...gene.dominance.homozygous,
                                  name: e.target.value,
                                };
                                const nextDominance = {
                                  ...gene.dominance,
                                  homozygous,
                                };
                                const stillHasEffect =
                                  computeDominanceRows(
                                    { ...nextDominance, enabled: true },
                                    ''
                                  ).length > 0;
                                updateGene({
                                  dominance: {
                                    ...nextDominance,
                                    enabled: stillHasEffect
                                      ? gene.dominance.enabled
                                      : false,
                                  },
                                });
                              }}
                            />
                            <label className='label cursor-pointer gap-1'>
                              <span
                                className={`label-text ${
                                  gene.dominance.homozygous.name === ''
                                    ? 'opacity-50'
                                    : ''
                                }`}
                              >
                                rescued by WT
                              </span>
                              <input
                                type='checkbox'
                                className='checkbox checkbox-sm'
                                checked={gene.dominance.homozygous.rescuedByWT}
                                disabled={gene.dominance.homozygous.name === ''}
                                onChange={(e) => {
                                  updateGene({
                                    dominance: {
                                      ...gene.dominance,
                                      homozygous: {
                                        ...gene.dominance.homozygous,
                                        rescuedByWT: e.target.checked,
                                      },
                                    },
                                  });
                                }}
                              />
                            </label>
                          </div>
                          <div className='flex items-center gap-1'>
                            <span className='text-sm'>+/- Phenotype</span>
                            <input
                              type='text'
                              placeholder='Name'
                              className='input input-bordered input-sm w-24'
                              value={gene.dominance.heterozygous.name}
                              onChange={(e) => {
                                const heterozygous = {
                                  ...gene.dominance.heterozygous,
                                  name: e.target.value,
                                };
                                const nextDominance = {
                                  ...gene.dominance,
                                  heterozygous,
                                };
                                const stillHasEffect =
                                  computeDominanceRows(
                                    { ...nextDominance, enabled: true },
                                    ''
                                  ).length > 0;
                                updateGene({
                                  dominance: {
                                    ...nextDominance,
                                    enabled: stillHasEffect
                                      ? gene.dominance.enabled
                                      : false,
                                  },
                                });
                              }}
                            />
                            <label className='label cursor-pointer gap-1'>
                              <span
                                className={`label-text ${
                                  gene.dominance.heterozygous.name === ''
                                    ? 'opacity-50'
                                    : ''
                                }`}
                              >
                                rescued by WT
                              </span>
                              <input
                                type='checkbox'
                                className='checkbox checkbox-sm'
                                checked={
                                  gene.dominance.heterozygous.rescuedByWT
                                }
                                disabled={
                                  gene.dominance.heterozygous.name === ''
                                }
                                onChange={(e) => {
                                  updateGene({
                                    dominance: {
                                      ...gene.dominance,
                                      heterozygous: {
                                        ...gene.dominance.heterozygous,
                                        rescuedByWT: e.target.checked,
                                      },
                                    },
                                  });
                                }}
                              />
                            </label>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              <RescuesGeneControl
                key={`rescuesGene-${activeTab}`}
                state={
                  activeTab === 'gene'
                    ? gene.rescuesGene
                    : activeVariationTab.rescuesGene
                }
                onChange={(state) => {
                  if (activeTab === 'gene') updateGene({ rescuesGene: state });
                  else setActiveVariationTab({ rescuesGene: state });
                }}
              />
              <FluorescentMarkerControl
                key={`fluorescentMarker-${activeTab}`}
                state={
                  activeTab === 'gene'
                    ? gene.fluorescentMarker
                    : activeVariationTab.fluorescentMarker
                }
                onChange={(state) => {
                  if (activeTab === 'gene')
                    updateGene({ fluorescentMarker: state });
                  else setActiveVariationTab({ fluorescentMarker: state });
                }}
              />
            </div>
          ) : (
            <div className='flex flex-col'>
              {(activeTab === 'gene'
                ? gene.phenotypeRows
                : activeVariationTab.phenotypeRows
              ).map((row) => (
                <PhenotypeRow
                  key={row.id}
                  row={row}
                  onChange={(updated) => {
                    const update = (
                      rows: Array<typeof row>
                    ): Array<typeof row> =>
                      rows.map((r) => (r.id === row.id ? updated : r));
                    if (activeTab === 'gene')
                      setGene((prev) => ({
                        ...prev,
                        phenotypeRows: update(prev.phenotypeRows),
                      }));
                    else
                      setActiveVariationTab({
                        phenotypeRows: update(activeVariationTab.phenotypeRows),
                      });
                  }}
                  onDelete={() => {
                    const filtered = (
                      activeTab === 'gene'
                        ? gene.phenotypeRows
                        : activeVariationTab.phenotypeRows
                    ).filter((r) => r.id !== row.id);
                    if (activeTab === 'gene')
                      setGene((prev) => ({ ...prev, phenotypeRows: filtered }));
                    else setActiveVariationTab({ phenotypeRows: filtered });
                  }}
                />
              ))}
              <button
                type='button'
                className='btn btn-ghost btn-sm mt-2 w-fit'
                onClick={() => {
                  const newRow = defaultPhenotypeRow(
                    `row-${Date.now()}-${Math.random()}`
                  );
                  if (activeTab === 'gene')
                    setGene((prev) => ({
                      ...prev,
                      phenotypeRows: [...prev.phenotypeRows, newRow],
                    }));
                  else
                    setActiveVariationTab({
                      phenotypeRows: [
                        ...activeVariationTab.phenotypeRows,
                        newRow,
                      ],
                    });
                }}
              >
                add another phenotype
              </button>
            </div>
          )}

          <div className='modal-action'>
            <button className='btn btn-ghost' onClick={close}>
              Cancel
            </button>
            <button
              className='btn btn-primary'
              disabled={!canCreate}
              onClick={handleCreate}
            >
              Add Allele
            </button>
          </div>
        </div>
        <label className='modal-backdrop' onClick={close} />
      </div>
    </>
  );
};

export default NewAlleleModal;
