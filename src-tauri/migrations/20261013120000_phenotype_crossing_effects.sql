-- Phenotypes that change the crossing mechanism itself. `female_sterile` (a
-- placeholder nothing read) becomes female + self crossing defective; a phenotype
-- with male_mating = 0 becomes male crossing defective. male_mating stays.
ALTER TABLE phenotypes ADD COLUMN male_crossing_defective INTEGER NULL;
ALTER TABLE phenotypes ADD COLUMN female_crossing_defective INTEGER NULL;
ALTER TABLE phenotypes ADD COLUMN self_crossing_defective INTEGER NULL;
-- A hermaphrodite with this phenotype produces males from a self cross
ALTER TABLE phenotypes ADD COLUMN him INTEGER NULL;

UPDATE phenotypes SET
    male_crossing_defective = CASE WHEN male_mating = 0 THEN 1 END,
    female_crossing_defective = CASE WHEN female_sterile = 1 THEN 1 END,
    self_crossing_defective = CASE WHEN female_sterile = 1 THEN 1 END;

ALTER TABLE phenotypes DROP COLUMN female_sterile;
