import { getSelectedPills } from 'components/SelectedPill/SelectedPill';
import { type db_Allele } from 'models/db/db_Allele';
import { type db_Gene } from 'models/db/db_Gene';
import React, { useEffect, useRef, useState } from 'react';
import { getAlleleEntries, searchAlleles } from 'utils/searchIndex';

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

export const AlleleMultiSelect = (
  props: AlleleMultiSelectProps
): React.JSX.Element => {
  const [searchRes, setSearchRes] = useState(new Array<[db_Allele, db_Gene]>());
  const [total, setTotal] = useState(0);
  const [userInput, setUserInput] = useState('');
  // The text the current results are for, so "+ New allele" is offered only
  // once a search for what is typed has come back empty
  const [searchedText, setSearchedText] = useState('');
  // Identifies the latest search, so a slower earlier one can't overwrite it
  const latestSearch = useRef(0);
  // Start loading the names as the box opens, so the first keystroke is quick
  useEffect(() => {
    getAlleleEntries().catch(console.error);
  }, []);

  const onInputChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const value = event.target.value;
    setUserInput(value);
    const thisSearch = ++latestSearch.current;
    if (value.trim() === '') {
      setSearchRes([]);
      setTotal(0);
      setSearchedText('');
      return;
    }

    // The names are searched in memory (see `utils/searchIndex.ts`)
    const shouldInclude = props.shouldInclude ?? (() => true);
    getAlleleEntries()
      .then((entries) => {
        if (thisSearch !== latestSearch.current) return;
        const result = searchAlleles(entries, value, shouldInclude);
        setSearchRes(
          result.matches.map((entry): [db_Allele, db_Gene] => [
            entry.allele,
            entry.gene,
          ])
        );
        setTotal(result.total);
        setSearchedText(value);
      })
      .catch(console.error);
  };

  const clearSearch = (): void => {
    latestSearch.current++;
    setUserInput('');
    setSearchRes([]);
    setTotal(0);
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
            {total > searchRes.length && (
              <li className='disabled px-4 py-2 text-sm opacity-70'>
                Showing {searchRes.length} of {total.toLocaleString()} - keep
                typing to narrow
              </li>
            )}
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
