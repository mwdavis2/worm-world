-- A relation can name a phenotype of the animal's hermaphrodite mother (a
-- maternal effect) instead of the animal's own. Existing rows are not maternal.
ALTER TABLE expr_relations ADD COLUMN altering_phenotype_maternal INTEGER NOT NULL DEFAULT 0;

-- The same relation may exist once as zygotic and once as maternal.
DROP INDEX expr_relations_unique_row;
CREATE UNIQUE INDEX expr_relations_unique_row ON expr_relations (
    allele_name,
    expressing_phenotype_name,
    expressing_phenotype_wild,
    COALESCE(altering_phenotype_name, ''),
    COALESCE(altering_phenotype_wild, -1),
    COALESCE(altering_condition, ''),
    is_suppressing,
    altering_phenotype_maternal
);
