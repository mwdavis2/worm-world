use serde::{Deserialize, Serialize};
use std::str::FromStr;
use strum_macros::Display;
use strum_macros::EnumString;
use ts_rs::TS;

#[derive(Serialize, Deserialize, Debug, Hash, PartialEq, Eq, TS, EnumString, Display)]
#[ts(export, export_to = "../src/models/db/filter/db_ChromosomeName.ts")]
pub enum ChromosomeName {
    #[strum(serialize = "I")]
    I,
    #[serde(rename = "II")]
    #[strum(serialize = "II")]
    Ii,
    #[serde(rename = "III")]
    #[strum(serialize = "III")]
    Iii,
    #[serde(rename = "IV")]
    #[strum(serialize = "IV")]
    Iv,
    #[strum(serialize = "V")]
    V,
    #[strum(serialize = "X")]
    X,
    #[serde(rename = "MtDNA")]
    MtDNA,
    #[strum(serialize = "Ex")]
    Ex,
}

impl From<String> for ChromosomeName {
    fn from(to_convert: String) -> Self {
        ChromosomeName::from_str(to_convert.as_str()).unwrap()
    }
}

impl ChromosomeName {
    /// Bulk-import chromosome columns are plain strings, not validated against
    /// this enum at deserialize time, so a bad CSV value (e.g. "chrI") would
    /// otherwise get written to the DB and later panic every read of that row
    /// via `From<String> for ChromosomeName`. Call this before inserting.
    pub fn validate(value: &Option<String>) -> Result<(), String> {
        match value {
            Some(v) if ChromosomeName::from_str(v).is_err() => Err(v.clone()),
            _ => Ok(()),
        }
    }
}
