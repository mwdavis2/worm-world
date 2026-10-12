-- A conversion rule: in a germline expressing the driver phenotype, each copy
-- of the source allele becomes the product allele with the given probability
-- (Cre/lox excision, FLP/FRT, ...). The product is an ordinary allele with its
-- own phenotype rows; it must belong to the same gene or variation as the
-- source (checked when a row is inserted).
CREATE TABLE allele_conversions (
    source_allele TEXT NOT NULL,
    product_allele TEXT NOT NULL,
    driver_phenotype_name TEXT NOT NULL,
    driver_phenotype_wild INTEGER NOT NULL,
    -- 0 to 100, like variations.percent_loss
    percent_conversion REAL NOT NULL DEFAULT 100,
    description TEXT NULL,
    PRIMARY KEY (
        source_allele,
        product_allele,
        driver_phenotype_name,
        driver_phenotype_wild
    ),
    FOREIGN KEY (source_allele) REFERENCES alleles (name),
    FOREIGN KEY (product_allele) REFERENCES alleles (name),
    FOREIGN KEY (driver_phenotype_name, driver_phenotype_wild) REFERENCES phenotypes (name, wild),
    CHECK (percent_conversion >= 0 AND percent_conversion <= 100),
    CHECK (source_allele <> product_allele)
);
