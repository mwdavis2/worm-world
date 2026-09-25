import { getFilteredGenes } from 'api/gene';
import { type db_Gene } from 'models/db/db_Gene';
import { type GeneFieldName } from 'models/db/filter/db_GeneFieldName';
import { type FilterGroup } from 'models/db/filter/FilterGroup';
import { Gene } from 'models/frontend/Gene/Gene';
import { useState } from 'react';

export interface GeneSearchInputProps {
  selectedGene?: Gene;
  onSelect: (gene: Gene) => void;
  placeholder?: string;
}

// A single-pick gene search field - forked from StrainForm.tsx's unexported
// StrainSelect pattern (search -> dropdown -> click replaces the one value)
// rather than reusing AlleleMultiSelect/DynamicMultiSelect, both of which
// are hard-coded multi-select Set accumulators with no "pick exactly one,
// replace" mode. Searches both SysName and DescName (merged into one
// dropdown, deduped by sysName) - matches how AlleleMultiSelect already
// merges allele-name + gene-descName filters. The real Genes table has
// 47,611 rows (confirmed directly), so this must stay a live-filtered
// search, never a full list.
export const GeneSearchInput = (
  props: GeneSearchInputProps
): React.JSX.Element => {
  const [searchRes, setSearchRes] = useState<db_Gene[]>([]);
  const [text, setText] = useState(
    props.selectedGene?.descName ?? props.selectedGene?.sysName ?? ''
  );

  const onInputChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const value = event.target.value;
    setText(value);
    if (value === '') {
      setSearchRes([]);
      return;
    }
    const bySysName: FilterGroup<GeneFieldName> = {
      filters: [[['SysName', { Like: value }]]],
      orderBy: [],
    };
    const byDescName: FilterGroup<GeneFieldName> = {
      filters: [[['DescName', { Like: value }]]],
      orderBy: [],
    };
    Promise.all([getFilteredGenes(bySysName), getFilteredGenes(byDescName)])
      .then(([sysNameRes, descNameRes]) => {
        const merged = new Map<string, db_Gene>();
        [...sysNameRes, ...descNameRes].forEach((gene) => {
          merged.set(gene.sysName, gene);
        });
        setSearchRes([...merged.values()]);
      })
      .catch(console.error);
  };

  const select = (gene: db_Gene): void => {
    props.onSelect(Gene.createFromRecord(gene));
    setText(gene.descName ?? gene.sysName);
    setSearchRes([]);
  };

  return (
    <div className='dropdown w-full'>
      <input
        type='text'
        placeholder={props.placeholder ?? 'Type gene name'}
        className='input input-bordered w-full'
        onChange={onInputChange}
        value={text}
      />
      {searchRes.length === 0 ? (
        <></>
      ) : (
        <ul className='menu dropdown-content rounded-box z-50 my-2 max-h-80 w-full overflow-auto bg-base-100 p-2 shadow'>
          {searchRes.map((gene, idx) => {
            const optionText = gene.descName ?? gene.sysName;
            return (
              <li
                key={idx}
                tabIndex={0}
                onClick={() => {
                  select(gene);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') select(gene);
                }}
              >
                <a>{optionText}</a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default GeneSearchInput;
