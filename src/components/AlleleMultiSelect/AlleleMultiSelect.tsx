import { getFilteredAllelesWithGeneFilter } from 'api/allele';
import { getSelectedPills } from 'components/SelectedPill/SelectedPill';
import { type db_Allele } from 'models/db/db_Allele';
import { type db_Gene } from 'models/db/db_Gene';
import { type Filter } from 'models/db/filter/Filter';
import { type FilterGroup } from 'models/db/filter/FilterGroup';
import { type AlleleFieldName } from 'models/db/filter/db_AlleleFieldName';
import { type GeneFieldName } from 'models/db/filter/db_GeneFieldName';
import React, { useEffect, useRef, useState } from 'react';

export interface AlleleMultiSelectProps {
  /** provide the api call that will fetch filtered db records */
  selectedRecords: Set<db_Allele>;
  setSelectedRecords: (newSelected: Set<db_Allele>) => void;
  /** Frontend relationships (e.g. gene-allele) may warrant conditional inclusion */
  shouldInclude?: (option: db_Allele) => boolean;
  /** Mandatory for testing */
  placeholder?: string;

  label?: string;
  // When set, shows a "+ New allele" option whenever the typed search text
  // has no matches - the parent owns the actual NewAlleleModal instance
  // (this component is used 4 times across StrainForm/AddStrainModal, so one
  // modal per parent rather than per picker).
  onRequestNewAllele?: (prefillName: string) => void;
}

// At most this many alleles are listed; typing more narrows them
export const MAX_RESULTS = 50;
// Rows fetched per query. Larger than MAX_RESULTS because `shouldInclude`
// (e.g. alleles already chosen) is applied after the fetch.
const FETCH_LIMIT = 200;
// Wait this long after the last keystroke before searching
export const SEARCH_DELAY_MS = 150;
export const MIN_SEARCH_LENGTH = 2;

type Match = Array<[db_Allele, db_Gene]>;

// Alleles whose name (or gene name) starts with the text, then those that
// merely contain it, each capped so a short search never pulls back thousands
// of rows.
const searchAlleles = async (value: string): Promise<Match> => {
  const query = async (
    alleleFilter: Filter,
    geneFilter: Filter
  ): Promise<Match> =>
    await getFilteredAllelesWithGeneFilter(
      {
        filters: [[['Name', alleleFilter]]],
        orderBy: [],
        limit: FETCH_LIMIT,
      } satisfies FilterGroup<AlleleFieldName>,
      {
        filters: [[['DescName', geneFilter]]],
        orderBy: [],
      } satisfies FilterGroup<GeneFieldName>
    );
  const [starts, contains] = await Promise.all([
    query({ StartsWith: value }, { StartsWith: value }),
    query({ Like: value }, { Like: value }),
  ]);
  const merged = new Map<string, [db_Allele, db_Gene]>();
  for (const match of [...starts, ...contains]) {
    if (!merged.has(match[0].name)) merged.set(match[0].name, match);
  }
  return [...merged.values()];
};

export const AlleleMultiSelect = (
  props: AlleleMultiSelectProps
): React.JSX.Element => {
  const [searchRes, setSearchRes] = useState(new Array<[db_Allele, db_Gene]>());
  const [userInput, setUserInput] = useState('');
  // The text the current results are for, so "+ New allele" is offered only
  // once a search for what is typed has come back empty
  const [searchedText, setSearchedText] = useState('');
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
    setUserInput(value);
    clearTimeout(timer.current);
    const thisSearch = ++latestSearch.current;
    if (value.length < MIN_SEARCH_LENGTH) {
      // Keep select option menu empty until there is enough to search for
      setSearchRes([]);
      setSearchedText('');
      return;
    }

    // Query from DB and do final filtering on frontend
    const shouldInclude = props.shouldInclude ?? (() => true);
    timer.current = setTimeout(() => {
      searchAlleles(value)
        .then((results) => {
          if (thisSearch !== latestSearch.current) return;
          setSearchRes(
            results.filter((res) => shouldInclude(res[0])).slice(0, MAX_RESULTS)
          );
          setSearchedText(value);
        })
        .catch(console.error);
    }, SEARCH_DELAY_MS);
  };

  const clearSearch = (): void => {
    clearTimeout(timer.current);
    latestSearch.current++;
    setUserInput('');
    setSearchRes([]);
    setSearchedText('');
  };

  const removeFromSelected = (value: db_Allele): void => {
    const newSelectedRecords = new Set<db_Allele>(props.selectedRecords);
    newSelectedRecords.delete(value);
    props.setSelectedRecords(newSelectedRecords);
  };

  return (
    <div>
      {props.label !== undefined && (
        <label htmlFor={`AlleleMultiSelect-${props.label}`} className='label'>
          <span className='label-text'>{props.label}</span>
        </label>
      )}
      <div className='dropdown w-full'>
        <input
          id={`AlleleMultiSelect-${props.label}`}
          type='text'
          placeholder={props.placeholder}
          className='input input-bordered w-full max-w-xs'
          onChange={onInputChange}
          value={userInput}
        />
        {userInput.length > 0 && userInput.length < MIN_SEARCH_LENGTH && (
          <div className='dropdown-content rounded-box z-50 my-2 w-52 bg-base-100 p-3 text-sm opacity-70 shadow'>
            Type at least {MIN_SEARCH_LENGTH} characters
          </div>
        )}
        {searchRes.length === 0 ? (
          userInput !== '' &&
          searchedText === userInput &&
          props.onRequestNewAllele !== undefined ? (
            <ul className='menu dropdown-content rounded-box z-50 my-2 w-52 overflow-auto bg-base-100 p-2 shadow'>
              <li
                tabIndex={0}
                onClick={() => {
                  props.onRequestNewAllele?.(userInput);
                  clearSearch();
                }}
              >
                <a>+ New allele &quot;{userInput}&quot;</a>
              </li>
            </ul>
          ) : (
            <></> // Don't show list if no results
          )
        ) : (
          <ul className='menu dropdown-content rounded-box z-50 my-2 w-52 overflow-auto bg-base-100 p-2 shadow'>
            {searchRes.map((record, idx) => {
              const [allele, gene] = record;
              const optionText =
                gene.descName !== null
                  ? `${gene.descName}(${allele.name})`
                  : allele.name;
              return (
                <li
                  key={`${record}-${idx}`}
                  tabIndex={0}
                  onClick={() => {
                    clearSearch();
                    props.setSelectedRecords(
                      new Set(props.selectedRecords).add(allele)
                    );
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      clearSearch();
                      props.setSelectedRecords(
                        new Set(props.selectedRecords).add(allele)
                      );
                    }
                  }}
                >
                  <a>{optionText}</a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div
        data-testid='selected-pill-group'
        className='flex max-w-xs flex-wrap'
      >
        {getSelectedPills(props.selectedRecords, removeFromSelected, ['name'])}
      </div>
    </div>
  );
};
