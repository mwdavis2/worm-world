import { invoke } from '@tauri-apps/api/tauri';
import { type db_Condition } from 'models/db/db_Condition';
import { type ConditionFieldName } from 'models/db/filter/db_ConditionFieldName';
import { type ExpressionRelationFieldName } from 'models/db/filter/db_ExpressionRelationFieldName';
import {
  type FilterGroup,
  getDbBoolean,
  getSingleRecordOrThrow,
  getSingleRecordOrUndefined,
} from 'models/db/filter/FilterGroup';
import { type Condition } from 'models/frontend/Condition/Condition';

export const getConditions = async (): Promise<db_Condition[]> => {
  return await invoke('get_conditions');
};

export const getFilteredConditions = async (
  filter: FilterGroup<ConditionFieldName>
): Promise<db_Condition[]> => {
  return await invoke('get_filtered_conditions', {
    filter,
  });
};

export const getCountFilteredConditions = async (
  filter: FilterGroup<ConditionFieldName>
): Promise<number> => {
  return await invoke('get_count_filtered_conditions', {
    filter,
  });
};

const conditionFilter = (name: string): FilterGroup<ConditionFieldName> => ({
  filters: [[['Name', { Equal: name }]]],
  orderBy: [],
});

/** The condition called `name`; throws if there is none. */
export const getCondition = async (name: string): Promise<db_Condition> => {
  const res = await getFilteredConditions(conditionFilter(name));
  return getSingleRecordOrThrow(
    res,
    `Unable to find a condition with the name: ${name}`
  );
};

/** The condition called `name`, or `undefined` if there is none. */
export const findCondition = async (
  name: string
): Promise<db_Condition | undefined> => {
  return getSingleRecordOrUndefined(
    await getFilteredConditions(conditionFilter(name))
  );
};

export const getAlteringConditions = async (
  alleleName: string,
  phenotypeName: string,
  phenotypeWild: boolean,
  isSuppressing: boolean
): Promise<db_Condition[]> => {
  // Build expression relation filter
  const exprRelationFilter: FilterGroup<ExpressionRelationFieldName> = {
    filters: [
      [['AlleleName', { Equal: alleleName }]],
      [['ExpressingPhenotypeName', { Equal: phenotypeName }]],
      [['ExpressingPhenotypeWild', getDbBoolean(phenotypeWild)]],
      [['IsSuppressing', getDbBoolean(isSuppressing)]],
    ],
    orderBy: [],
  };

  const conditionFilter: FilterGroup<ConditionFieldName> = {
    filters: [],
    orderBy: [],
  };

  return await invoke('get_altering_conditions', {
    exprRelationFilter,
    conditionFilter,
  });
};

export const insertCondition = async (condition: Condition): Promise<void> => {
  await insertDbCondition(condition.generateRecord());
};

export const insertDbCondition = async (
  record: db_Condition
): Promise<void> => {
  await invoke('insert_condition', { condition: record });
};

// Changes a condition's non-key columns; its name picks the row.
export const updateDbCondition = async (
  record: db_Condition
): Promise<void> => {
  await invoke('update_condition', { condition: record });
};

export const insertConditionsFromFile = async (path: string): Promise<void> => {
  await invoke('insert_conditions_from_file', { path });
};

export const deleteFilteredConditions = async (
  filter: FilterGroup<ConditionFieldName>
): Promise<void> => {
  await invoke('delete_filtered_conditions', { filter });
};

export const deleteCondition = async (
  condition: db_Condition
): Promise<void> => {
  const filter: FilterGroup<ConditionFieldName> = {
    filters: [[['Name', { Equal: condition.name }]]],
    orderBy: [],
  };

  await deleteFilteredConditions(filter);
};
