DELETE FROM expr_relations
WHERE allele_name = 'n498' AND expressing_phenotype_name = 'Unc-43' AND expressing_phenotype_wild = 0;
DELETE FROM allele_exprs
WHERE allele_name = 'n498' AND expressing_phenotype_name = 'Unc-43' AND expressing_phenotype_wild = 0;
DELETE FROM phenotypes
WHERE name = 'Unc-43' AND wild = 0
  AND NOT EXISTS (SELECT 1 FROM allele_exprs WHERE expressing_phenotype_name = 'Unc-43' AND expressing_phenotype_wild = 0);
