-- expr_relations' primary key includes nullable columns, and SQLite does not
-- treat NULLs as equal in a key, so importing the same relations again inserted
-- duplicates (INSERT OR IGNORE had nothing to conflict with). Remove the
-- existing duplicates, then add a unique index that treats NULLs as equal so
-- the import's INSERT OR IGNORE skips rows that are already there.
DELETE FROM expr_relations
WHERE rowid NOT IN (
    SELECT MIN(rowid)
    FROM expr_relations
    GROUP BY
        allele_name,
        expressing_phenotype_name,
        expressing_phenotype_wild,
        COALESCE(altering_phenotype_name, ''),
        COALESCE(altering_phenotype_wild, -1),
        COALESCE(altering_condition, ''),
        is_suppressing
);

CREATE UNIQUE INDEX expr_relations_unique_row ON expr_relations (
    allele_name,
    expressing_phenotype_name,
    expressing_phenotype_wild,
    COALESCE(altering_phenotype_name, ''),
    COALESCE(altering_phenotype_wild, -1),
    COALESCE(altering_condition, ''),
    is_suppressing
);
