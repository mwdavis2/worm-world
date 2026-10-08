use super::FieldNameEnum;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Serialize, Deserialize, Debug, sqlx::FromRow, PartialEq, Eq, TS)]
#[ts(export, export_to = "../src/models/db/db_Allele.ts")]
#[serde(rename = "db_Allele")]
pub struct Allele {
    pub name: String,
    pub contents: Option<String>,
    #[serde(rename = "sysGeneName")]
    pub systematic_gene_name: Option<String>,
    #[serde(rename = "variationName")]
    pub variation_name: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Hash, PartialEq, Eq, TS)]
#[ts(export, export_to = "../src/models/db/filter/db_AlleleFieldName.ts")]
pub enum AlleleFieldName {
    Name,
    Contents,
    SysGeneName,
    VariationName,
    /// Virtual column: true when no strain has the allele (filter it with `Filter::True`)
    Unused,
}

/// SQL condition (on the `alleles` table) for an allele no strain has
pub const UNUSED_ALLELE_SQL: &str =
    "(alleles.name NOT IN (SELECT allele_name FROM strain_alleles))";

impl FieldNameEnum for AlleleFieldName {
    fn get_col_name(&self) -> String {
        match self {
            AlleleFieldName::Name => "name".to_owned(),
            AlleleFieldName::Contents => "contents".to_owned(),
            AlleleFieldName::SysGeneName => "systematic_gene_name".to_owned(),
            AlleleFieldName::VariationName => "variation_name".to_owned(),
            AlleleFieldName::Unused => UNUSED_ALLELE_SQL.to_owned(),
        }
    }
}
