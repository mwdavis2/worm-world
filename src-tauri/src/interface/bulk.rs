use anyhow::Result;
use csv::Reader;
use serde::de::DeserializeOwned;
use std::path::Path;

// TODO: every insert_X(bulk) consumer of this struct writes its valid rows
// via "INSERT OR IGNORE", which silently drops any row that violates a
// constraint (most commonly a duplicate primary key, e.g. a repeated gene
// systematic_name) - the user gets no indication anything was skipped.
// Comparing bulk.data.len() against the summed rows_affected() of each
// insert statement would give an accurate skipped-row count; surfacing that
// to the UI requires changing insert_X's return type (and the matching
// Tauri command, ts-rs binding, frontend api wrapper, and DataTableView's
// shared import-success toast) across all 9 tables that use Bulk.
pub struct Bulk<T>
where
    T: DeserializeOwned,
{
    pub data: Vec<T>,
    pub errors: Vec<(usize, String)>,
}
impl<T: DeserializeOwned> Bulk<T> {
    /// Reads in data from csv/tsv at given path
    pub fn new(path: &Path) -> Result<Self> {
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(match path.extension() {
                None => b',',
                Some(t) => match t.to_str() {
                    Some("csv") => b',',
                    Some("tsv") => b'\t',
                    _ => b',',
                },
            })
            .from_path(path)?;

        Ok(Self::from_reader(&mut reader))
    }

    pub fn from_reader<K: std::io::Read>(reader: &mut Reader<K>) -> Self {
        let mut data: Vec<T> = vec![];
        let mut errors: Vec<(usize, String)> = vec![];
        for (i, rec) in reader.deserialize::<T>().enumerate() {
            match rec {
                Ok(val) => data.push(val),
                Err(e) => errors.push((i, e.to_string())),
            }
        }

        Self { data, errors }
    }
}
