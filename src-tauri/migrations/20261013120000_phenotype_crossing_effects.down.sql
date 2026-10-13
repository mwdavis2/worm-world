ALTER TABLE phenotypes ADD COLUMN female_sterile INTEGER NULL;

UPDATE phenotypes SET female_sterile = 1
WHERE female_crossing_defective = 1 AND self_crossing_defective = 1;

ALTER TABLE phenotypes DROP COLUMN him;
ALTER TABLE phenotypes DROP COLUMN self_crossing_defective;
ALTER TABLE phenotypes DROP COLUMN female_crossing_defective;
ALTER TABLE phenotypes DROP COLUMN male_crossing_defective;
