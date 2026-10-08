import { getFilteredGenes } from 'api/gene';
import { type db_Gene } from 'models/db/db_Gene';
import { type GeneFieldName } from 'models/db/filter/db_GeneFieldName';
import { type Filter } from 'models/db/filter/Filter';
import { Gene } from 'models/frontend/Gene/Gene';
import { useEffect, useRef, useState } from 'react';

export interface GeneSearchInputProps {
  selectedGene?: Gene;
  onSelect: (gene: Gene) => void;
  placeholder?: string;
  // For disambiguating multiple GeneSearchInput instances on the same page
  // (e.g. by role+name in tests) when their placeholders are identical.
  ariaLabel?: string;
}

// A gene's text in the dropdown: its descriptive name, plus its key in
// brackets when another result reads the same (the placeholder genes
// let-?(s1799), let-?(n886) ... all have the descriptive name "let-?").
export const optionLabel = (gene: db_Gene, results: db_Gene[]): string => {
  const text = gene.descName ?? gene.sysName;
  const repeated = results.some(
    (other) =>
      other.sysName !== gene.sysName &&
      (other.descName ?? other.sysName) === text
  );
  return repeated ? `${text} [${gene.sysName}]` : text;
};

// A single-pick gene search field - forked from StrainForm.tsx's unexported
// StrainSelect pattern (search -> dropdown -> click replaces the one value)
// rather than reusing AlleleMultiSelect/DynamicMultiSelect, both of which
// are hard-coded multi-select Set accumulators with no "pick exactly one,
// replace" mode. Searches both SysName and DescName (merged into one
// dropdown, deduped by sysName) - matches how AlleleMultiSelect already
// merges allele-name + gene-descName filters. The real Genes table has
// 47,611 rows (confirmed directly), so this must stay a live-filtered
// search, never a full list.
// At most this many genes are listed; typing more narrows them
export const MAX_RESULTS = 50;
// Wait this long after the last keystroke before searching
export const SEARCH_DELAY_MS = 150;
export const MIN_SEARCH_LENGTH = 2;

// Genes whose name starts with the text, then genes that merely contain it,
// each capped so a one- or two-letter search never pulls back thousands of
// rows.
const searchGenes = async (value: string): Promise<db_Gene[]> => {
  const query = async (
    field: GeneFieldName,
    filter: Filter
  ): Promise<db_Gene[]> =>
    await getFilteredGenes({
      filters: [[[field, filter]]],
      orderBy: [[field, 'Asc']],
      limit: MAX_RESULTS,
    });
  const [sysStarts, descStarts, sysContains, descContains] = await Promise.all([
    query('SysName', { StartsWith: value }),
    query('DescName', { StartsWith: value }),
    query('SysName', { Like: value }),
    query('DescName', { Like: value }),
  ]);
  const merged = new Map<string, db_Gene>();
  for (const gene of [
    ...descStarts,
    ...sysStarts,
    ...descContains,
    ...sysContains,
  ]) {
    if (!merged.has(gene.sysName)) merged.set(gene.sysName, gene);
  }
  return [...merged.values()].slice(0, MAX_RESULTS);
};

export const GeneSearchInput = (
  props: GeneSearchInputProps
): React.JSX.Element => {
  const [searchRes, setSearchRes] = useState<db_Gene[]>([]);
  const [text, setText] = useState(
    props.selectedGene?.descName ?? props.selectedGene?.sysName ?? ''
  );
  const timer = useRef<ReturnType<typeof setTimeout>>();
  // Identifies the latest search, so a slow earlier one can't overwrite it
  const latestSearch = useRef(0);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    []
  );

  const onInputChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const value = event.target.value;
    setText(value);
    clearTimeout(timer.current);
    const thisSearch = ++latestSearch.current;
    if (value.length < MIN_SEARCH_LENGTH) {
      setSearchRes([]);
      return;
    }
    timer.current = setTimeout(() => {
      searchGenes(value)
        .then((genes) => {
          if (thisSearch === latestSearch.current) setSearchRes(genes);
        })
        .catch(console.error);
    }, SEARCH_DELAY_MS);
  };

  const select = (gene: db_Gene): void => {
    clearTimeout(timer.current);
    latestSearch.current++;
    props.onSelect(Gene.createFromRecord(gene));
    setText(gene.descName ?? gene.sysName);
    setSearchRes([]);
  };

  return (
    <div className='dropdown w-full'>
      <input
        type='text'
        aria-label={props.ariaLabel}
        placeholder={props.placeholder ?? 'Gene name'}
        className='input input-bordered w-full'
        onChange={onInputChange}
        value={text}
      />
      {text.length > 0 && text.length < MIN_SEARCH_LENGTH && (
        <div className='dropdown-content rounded-box z-50 my-2 w-full bg-base-100 p-3 text-sm opacity-70 shadow'>
          Type at least {MIN_SEARCH_LENGTH} characters
        </div>
      )}
      {searchRes.length === 0 ? (
        <></>
      ) : (
        <ul className='menu dropdown-content rounded-box z-50 my-2 max-h-80 w-full overflow-auto bg-base-100 p-2 shadow'>
          {searchRes.map((gene, idx) => {
            const optionText = optionLabel(gene, searchRes);
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
