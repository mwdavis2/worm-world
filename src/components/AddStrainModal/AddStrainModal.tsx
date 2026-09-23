import { AlleleMultiSelect } from 'components/AlleleMultiSelect/AlleleMultiSelect';
import EditorContext from 'components/EditorContext/EditorContext';
import StrainCard from 'components/StrainCard/StrainCard';
import { type db_Allele } from 'models/db/db_Allele';
import { type db_Strain } from 'models/db/db_Strain';
import { Allele, isEcaAlleleName } from 'models/frontend/Allele/Allele';
import { AllelePair } from 'models/frontend/AllelePair/AllelePair';
import { Strain } from 'models/frontend/Strain/Strain';
import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';

interface AddStrainModalProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  // When set, the modal opens pre-populated with this strain's full state
  // (name/description/alleles) for editing rather than creating a new one.
  // Mutually exclusive with strainToLoad - only one source is ever passed.
  strainToEdit?: db_Strain;
  // Same idea, but for a strain that's already a fully-built frontend Strain
  // (e.g. a cross-design canvas node) - no DB round-trip needed to load it.
  strainToLoad?: Strain;
  // False for a strain that's already wired into a cross (parent or child) -
  // its alleles are load-bearing for the cross's already-computed
  // relationships, so this only lets the name/description be set, never the
  // genotype. Defaults to true (the data-table catalog's full-edit case).
  allowAlleleEditing?: boolean;
  // When set, shows an "Update strain" button that applies the current
  // edits back to the caller without writing to the database - lets a
  // freestanding card's alleles/description be changed without forcing an
  // immediate save. Not passed by the Strains data-table page, since there's
  // no in-memory canvas node there to apply an unsaved edit to.
  onUpdate?: (updatedStrain: Strain) => void;
  onSaved: (savedStrain: Strain) => void;
}

// Pairs up picked alleles into homozygous/heterozygous AllelePairs and builds
// a Strain from them. Forked from StrainForm's identically-named helper
// rather than reused directly: StrainForm is built for the cross-design
// editor (its "Strain" field searches/clones an existing strain, its submit
// button hands the built Strain to a parent for a separate naming step) -
// bending that into a single-panel "name it and save" flow for this catalog
// page conflicted with its own use case, so this is a dedicated fork of just
// the allele-pairing logic.
const buildStrain = async (
  regs: Set<db_Allele>,
  irregs: Set<db_Allele>
): Promise<Strain> => {
  const homoPairs = await Promise.all(
    Array.from(regs).map(async (dbAllele) => {
      const allele = await Allele.createFromRecord(dbAllele);
      return allele.isEca() ? allele.toTopHet() : allele.toHomo();
    })
  );

  // Merge co-located het pairs
  const hetPairs: AllelePair[] = [];
  const hetMap = new Map<string, Allele[]>();
  (
    await Promise.all(
      Array.from(irregs).map(
        async (allele) => await Allele.createFromRecord(allele)
      )
    )
  ).forEach((allele) => {
    const locus = allele.gene?.sysName ?? allele.variation?.name ?? '';
    hetMap.get(locus)?.push(allele) ?? hetMap.set(locus, [allele]);
  });
  hetMap.forEach((alleles) => {
    if (alleles.length > 2)
      throw new Error(
        'Cannot have more than two heterozygous alleles on one gene or variation.'
      );
    else if (alleles.length === 2)
      hetPairs.push(new AllelePair({ top: alleles[0], bot: alleles[1] }));
    else
      hetPairs.push(
        new AllelePair({ top: alleles[0], bot: alleles[0].toWild() })
      );
  });
  return await Strain.build({ allelePairs: [...homoPairs, ...hetPairs] });
};

const AddStrainModal = (props: AddStrainModalProps): React.JSX.Element => {
  const allowAlleleEditing = props.allowAlleleEditing ?? true;
  const [strain, setStrain] = useState(new Strain());
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  // The strain's name at the moment it was loaded for editing - saving may
  // rename it, so this is what identifies which row to update/replace.
  const [originalName, setOriginalName] = useState<string>();

  useEffect(() => {
    if (!props.isOpen) return;
    if (props.strainToEdit !== undefined) {
      const strainToEdit = props.strainToEdit;
      setOriginalName(strainToEdit.name);
      Strain.createFromRecord(strainToEdit)
        .then((loaded) => {
          setStrain(loaded);
          setName(loaded.name ?? '');
          setDescription(loaded.description ?? '');
        })
        .catch(console.error);
    } else if (props.strainToLoad !== undefined) {
      const strainToLoad = props.strainToLoad;
      setOriginalName(strainToLoad.name === '' ? undefined : strainToLoad.name);
      setStrain(strainToLoad);
      setName(strainToLoad.name);
      setDescription(strainToLoad.description ?? '');
    } else {
      setOriginalName(undefined);
      setStrain(new Strain());
      setName('');
      setDescription('');
    }
    setShowAdvanced(false);
    // Only (re)load when the modal opens or which strain it's editing
    // changes - not on every keystroke while it's open.
  }, [props.isOpen, props.strainToEdit?.name, props.strainToLoad]);

  const regAlleles = new Set(
    strain
      .getRegularAlleles(strain.sex)
      .map((allele) => allele.generateRecord())
  );
  const irregAlleles = new Set(
    strain
      .getIrregularAlleles(strain.sex)
      .map((allele) => allele.generateRecord())
  );
  if (irregAlleles.size > 0 && !showAdvanced) setShowAdvanced(true);

  const alleleIsUnused = (allele: db_Allele): boolean =>
    ![...regAlleles, ...irregAlleles].map((a) => a.name).includes(allele.name);

  const setStrainFromAlleles = (
    regs: Set<db_Allele>,
    irregs: Set<db_Allele>
  ): void => {
    buildStrain(regs, irregs)
      .then((built) => {
        built.description = strain.description;
        setStrain(built);
      })
      .catch(console.error);
  };

  const close = (): void => {
    props.setIsOpen(false);
  };

  const editorContextValue = {
    showGenes: true,
    toggleHetPair: !allowAlleleEditing
      ? undefined
      : (id: string, pair: AllelePair) => {
          pair.flip();
          Strain.build({ allelePairs: strain.getAllelePairs() })
            .then((built) => {
              built.description = strain.description;
              setStrain(built);
            })
            .catch(console.error);
        },
  };

  const handleUpdate = (): void => {
    strain.name = name;
    strain.description = description;
    props.onUpdate?.(strain);
    close();
  };

  const handleSave = (): void => {
    strain.name = name;
    strain.description = description;
    const result =
      originalName !== undefined ? strain.update(originalName) : strain.save();
    result
      .then(() => {
        toast.success('Saved strain');
        props.onSaved(strain);
        close();
      })
      .catch(() =>
        toast.error(
          'Unable to save strain. Make sure a strain with this name/genotype does not already exist.'
        )
      );
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
        <div className='modal-box max-w-2xl'>
          <h2 className='text-lg font-bold'>
            {originalName !== undefined ? 'Edit Strain' : 'New Strain'}
          </h2>
          <div className='form-control my-2'>
            <label className='label' htmlFor='new-strain-name-input'>
              <span className='label-text'>Strain name</span>
            </label>
            <input
              id='new-strain-name-input'
              className='input input-bordered w-full'
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
            />
          </div>
          <EditorContext.Provider value={editorContextValue}>
            <StrainCard strain={strain} id='add-strain-modal-preview' wide />
          </EditorContext.Provider>
          {allowAlleleEditing && (
            <AlleleMultiSelect
              placeholder='Type allele name'
              label='Alleles'
              selectedRecords={regAlleles}
              setSelectedRecords={(regs) => {
                setStrainFromAlleles(regs, irregAlleles);
              }}
              shouldInclude={alleleIsUnused}
            />
          )}
          {allowAlleleEditing && showAdvanced && (
            <AlleleMultiSelect
              placeholder='Type allele name'
              label='Heterozygous Alleles'
              selectedRecords={irregAlleles}
              setSelectedRecords={(irregs) => {
                setStrainFromAlleles(regAlleles, irregs);
              }}
              shouldInclude={(allele) =>
                alleleIsUnused(allele) && !isEcaAlleleName(allele.name)
              }
            />
          )}
          {(!allowAlleleEditing || showAdvanced) && (
            <div className='form-control my-2'>
              <label
                className='label'
                htmlFor='new-strain-description-textarea'
              >
                <span className='label-text'>Description</span>
              </label>
              <textarea
                id='new-strain-description-textarea'
                className='textarea textarea-bordered w-full'
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                }}
              />
            </div>
          )}
          <div className='modal-action justify-between'>
            {allowAlleleEditing && (
              <button
                className='btn btn-ghost'
                disabled={irregAlleles.size > 0}
                onClick={() => {
                  setShowAdvanced(!showAdvanced);
                }}
              >
                {showAdvanced
                  ? 'Hide advanced options'
                  : 'Show advanced options'}
              </button>
            )}
            <div className='flex gap-2'>
              <button className='btn btn-ghost' onClick={close}>
                Cancel
              </button>
              {props.onUpdate !== undefined && (
                <button className='btn btn-secondary' onClick={handleUpdate}>
                  Update strain
                </button>
              )}
              <button
                className='btn btn-primary'
                disabled={name === ''}
                onClick={handleSave}
              >
                Save Strain
              </button>
            </div>
          </div>
        </div>
        <label className='modal-backdrop' onClick={close} />
      </div>
    </>
  );
};

export default AddStrainModal;
