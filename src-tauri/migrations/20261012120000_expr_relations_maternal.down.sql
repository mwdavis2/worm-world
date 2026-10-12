DROP INDEX expr_relations_unique_row;
DELETE FROM expr_relations WHERE altering_phenotype_maternal = 1;
ALTER TABLE expr_relations DROP COLUMN altering_phenotype_maternal;
CREATE UNIQUE INDEX expr_relations_unique_row ON expr_relations (
    allele_name,
    expressing_phenotype_name,
    expressing_phenotype_wild,
    COALESCE(altering_phenotype_name, ''),
    COALESCE(altering_phenotype_wild, -1),
    COALESCE(altering_condition, ''),
    is_suppressing
);
