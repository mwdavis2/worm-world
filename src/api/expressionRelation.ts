import { invoke } from '@tauri-apps/api/tauri';
import { type db_TableImport } from 'models/db/db_TableImport';
import { type db_ExpressionRelation } from 'models/db/db_ExpressionRelation';
import { type ExpressionRelationFieldName } from 'models/db/filter/db_ExpressionRelationFieldName';
import { type FilterGroup, getDbBoolean } from 'models/db/filter/FilterGroup';

export const getExpressionRelations = async (): Promise<
  db_ExpressionRelation[]
> => {
  return await invoke('get_expr_relations');
};

export const getFilteredExpressionRelations = async (
  filter: FilterGroup<ExpressionRelationFieldName>
): Promise<db_ExpressionRelation[]> => {
  return await invoke('get_filtered_expr_relations', {
    filter,
  });
};

export const getCountFilteredExpressionRelations = async (
  filter: FilterGroup<ExpressionRelationFieldName>
): Promise<number> => {
  return await invoke('get_count_filtered_expr_relations', {
    filter,
  });
};

export const insertDbExpressionRelation = async (
  record: db_ExpressionRelation
): Promise<void> => {
  await invoke('insert_expr_relation', {
    exprRelation: record,
  });
};

// Changes whether a relationship is suppressing; its other columns pick it.
export const updateDbExpressionRelation = async (
  record: db_ExpressionRelation
): Promise<void> => {
  await invoke('update_expr_relation', {
    exprRelation: record,
  });
};

/**
 * Imports a CSV/TSV file into this table in one transaction. Rows already in
 * the table are kept as they are; the result says how many rows the file held
 * and how many were new.
 */
export const insertExpressionRelationsFromFile = async (
  path: string
): Promise<db_TableImport> => {
  return await invoke('insert_expr_relations_from_file', { path });
};

export const deleteFilteredExpressionRelations = async (
  filter: FilterGroup<ExpressionRelationFieldName>
): Promise<void> => {
  await invoke('delete_filtered_expr_relations', { filter });
};

export const deleteExpressionRelation = async (
  exprRel: db_ExpressionRelation
): Promise<void> => {
  // A relationship has either an altering phenotype or an altering condition,
  // so some of these columns are NULL - which must be matched with a NULL
  // test, not "= ''" (that matches nothing, silently deleting no rows).
  const filter: FilterGroup<ExpressionRelationFieldName> = {
    filters: [
      [['AlleleName', { Equal: exprRel.alleleName }]],
      [['ExpressingPhenotypeName', { Equal: exprRel.expressingPhenotypeName }]],
      [
        [
          'ExpressingPhenotypeWild',
          getDbBoolean(exprRel.expressingPhenotypeWild),
        ],
      ],
      [
        [
          'AlteringPhenotypeName',
          exprRel.alteringPhenotypeName === null
            ? 'Null'
            : { Equal: exprRel.alteringPhenotypeName },
        ],
      ],
      [
        [
          'AlteringPhenotypeWild',
          exprRel.alteringPhenotypeWild === null
            ? 'Null'
            : getDbBoolean(exprRel.alteringPhenotypeWild),
        ],
      ],
      [
        [
          'AlteringCondition',
          exprRel.alteringCondition === null
            ? 'Null'
            : { Equal: exprRel.alteringCondition },
        ],
      ],
    ],
    orderBy: [],
  };

  await deleteFilteredExpressionRelations(filter);
};
