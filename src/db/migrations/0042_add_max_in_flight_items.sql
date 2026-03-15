-- Add max_in_flight_items column to projects table.
-- NULL means use the default of 1 (single in-flight item per project).

ALTER TABLE projects ADD COLUMN max_in_flight_items INTEGER DEFAULT NULL;
