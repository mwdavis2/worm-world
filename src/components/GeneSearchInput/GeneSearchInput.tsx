import { type db_Gene } from 'models/db/db_Gene';
import { Gene } from 'models/frontend/Gene/Gene';
import { useEffect, useRef, useState } from 'react';
import { getGeneEntries, searchGenes } from 'utils/searchIndex';

export interface GeneSearchInputProps {
  selectedGene?: Gene;
  onSelect: (gene: Gene) => void;
  // Called when the text is edited after a gene was picked: the pick no longer
  // matches what the box shows.
  onClear?: () => void;
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
// dropdown). The gene names (47,611 rows) are searched in memory, see
// `utils/searchIndex.ts`, so results follow every keystroke from the first
// character; at most MAX_RESULTS are listed, with a count of the rest.
export const GeneSearchInput = (
  props: GeneSearchInputProps
): React.JSX.Element => {
  const [searchRes, setSearchRes] = useState<db_Gene[]>([]);
  const [total, setTotal] = useState(0);
  const [text, setText] = useState(
    props.selectedGene?.descName ?? props.selectedGene?.sysName ?? ''
  );
  // Identifies the latest search, so a slower earlier one can't overwrite it
  const latestSearch = useRef(0);
  // Start loading the names as the box opens, so the first keystroke is quick
  useEffect(() => {
    getGeneEntries().catch(console.error);
  }, []);

  const onInputChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const value = event.target.value;
    setText(value);
    if (props.selectedGene !== undefined) props.onClear?.();
    const thisSearch = ++latestSearch.current;
    if (value.trim() === '') {
      setSearchRes([]);
      setTotal(0);
      return;
    }
    getGeneEntries()
      .then((entries) => {
        if (thisSearch !== latestSearch.current) return;
        const result = searchGenes(entries, value);
        setSearchRes(result.matches.map((entry) => entry.gene));
        setTotal(result.total);
      })
      .catch(console.error);
  };

  const select = (gene: db_Gene): void => {
    latestSearch.current++;
    props.onSelect(Gene.createFromRecord(gene));
    setText(gene.descName ?? gene.sysName);
    setSearchRes([]);
    setTotal(0);
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
      {searchRes.length === 0 ? (
        <></>
      ) : (
        <ul className='menu dropdown-content rounded-box z-50 my-2 max-h-80 w-full flex-nowrap overflow-auto bg-base-100 p-2 shadow'>
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
          {total > searchRes.length && (
            <li className='pointer-events-none sticky -bottom-2 bg-base-100 px-4 py-2 text-sm text-base-content/70'>
              Showing {searchRes.length} of {total.toLocaleString()} - keep
              typing to narrow
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

export default GeneSearchInput;
