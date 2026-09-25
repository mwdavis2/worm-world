use super::{chromosome_name::ChromosomeName, FieldNameEnum};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Serialize, Deserialize, Debug, sqlx::FromRow, PartialEq, TS)]
#[ts(export, export_to = "../src/models/db/db_Variation.ts")]
#[serde(rename = "db_Variation")]
pub struct Variation {
    #[serde(rename = "alleleName")]
    pub allele_name: String,
    pub chromosome: Option<ChromosomeName>,
    #[serde(rename = "physLoc")]
    pub phys_loc: Option<i32>,
    #[serde(rename = "geneticLoc")]
    pub gen_loc: Option<f64>,
    #[serde(rename = "recombSuppressor")]
    pub recomb_suppressor: Option<(i32, i32)>,
    #[serde(rename = "isLocationReference")]
    pub is_location_reference: bool,
    #[serde(rename = "percentLoss")]
    pub percent_loss: Option<f64>,
}

impl From<VariationDb> for Variation {
    fn from(item: VariationDb) -> Variation {
        Variation {
            allele_name: item.allele_name,
            chromosome: item.chromosome.map(|v| v.into()),
            phys_loc: item.phys_loc.map(|v| v as i32),
            gen_loc: item.gen_loc,
            recomb_suppressor: match (item.recomb_suppressor_start, item.recomb_suppressor_end) {
                (Some(start), Some(end)) => Some((start as i32, end as i32)),
                _ => None,
            },
            is_location_reference: item.is_location_reference,
            percent_loss: item.percent_loss,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, sqlx::FromRow)]
pub struct VariationDb {
    #[serde(rename = "alleleName")]
    pub allele_name: String,
    pub chromosome: Option<String>,
    #[serde(rename = "physLoc")]
    pub phys_loc: Option<i64>,
    #[serde(rename = "geneticLoc")]
    pub gen_loc: Option<f64>,
    #[serde(rename = "recombSuppressorStart")]
    pub recomb_suppressor_start: Option<i64>,
    #[serde(rename = "recombSuppressorEnd")]
    pub recomb_suppressor_end: Option<i64>,
    // #[serde(default)] so existing bulk-import CSVs (which predate these
    // columns) still parse - a missing column defaults to false/None rather
    // than failing deserialization.
    #[serde(rename = "isLocationReference", default)]
    pub is_location_reference: bool,
    #[serde(rename = "percentLoss", default)]
    pub percent_loss: Option<f64>,
}

#[derive(Serialize, Deserialize, Debug, Hash, PartialEq, Eq, TS)]
#[ts(export, export_to = "../src/models/db/filter/db_VariationFieldName.ts")]
pub enum VariationFieldName {
    AlleleName,
    Chromosome,
    PhysLoc,
    GenLoc,
    RecombSuppressor,
    IsLocationReference,
    PercentLoss,
}
impl FieldNameEnum for VariationFieldName {
    fn get_col_name(self: &VariationFieldName) -> String {
        match self {
            VariationFieldName::AlleleName => "allele_name".to_owned(),
            VariationFieldName::Chromosome => "chromosome".to_owned(),
            VariationFieldName::PhysLoc => "phys_loc".to_owned(),
            VariationFieldName::GenLoc => "gen_loc".to_owned(),
            VariationFieldName::RecombSuppressor => "recomb_suppressor".to_owned(),
            VariationFieldName::IsLocationReference => "is_location_reference".to_owned(),
            VariationFieldName::PercentLoss => "percent_loss".to_owned(),
        }
    }
}
