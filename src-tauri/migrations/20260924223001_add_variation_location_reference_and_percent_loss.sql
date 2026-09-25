ALTER TABLE variations ADD COLUMN is_location_reference BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE variations ADD COLUMN percent_loss REAL NULL;
