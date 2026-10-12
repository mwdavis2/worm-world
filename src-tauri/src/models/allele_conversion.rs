use super::FieldNameEnum;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A rule that turns one allele into another in a germline that expresses a
/// driver phenotype (Cre/lox, FLP/FRT, ...). `percent_conversion` is 0 to 100.
#[derive(Serialize, Deserialize, Debug, sqlx::FromRow, PartialEq, TS)]
#[ts(export, export_to = "../src/models/db/db_AlleleConversion.ts")]
#[serde(rename = "db_AlleleConversion")]
pub struct AlleleConversion {
    #[serde(rename = "sourceAllele")]
    pub source_allele: String,
    #[serde(rename = "productAllele")]
    pub product_allele: String,
    #[serde(rename = "driverPhenotypeName")]
    pub driver_phenotype_name: String,
    #[serde(rename = "driverPhenotypeWild")]
    pub driver_phenotype_wild: bool,
    #[serde(rename = "percentConversion")]
    pub percent_conversion: f64,
    pub description: Option<String>,
}

impl From<AlleleConversionDb> for AlleleConversion {
    fn from(item: AlleleConversionDb) -> AlleleConversion {
        AlleleConversion {
            source_allele: item.source_allele,
            product_allele: item.product_allele,
            driver_phenotype_name: item.driver_phenotype_name,
            driver_phenotype_wild: item.driver_phenotype_wild == 1,
            percent_conversion: item.percent_conversion,
            description: item.description,
        }
    }
}

/// The row as the database and the import files hold it (camelCase headers,
/// the wild flag as 0/1).
#[derive(Serialize, Deserialize, Debug, sqlx::FromRow)]
pub struct AlleleConversionDb {
    #[serde(rename = "sourceAllele")]
    pub source_allele: String,
    #[serde(rename = "productAllele")]
    pub product_allele: String,
    #[serde(rename = "driverPhenotypeName")]
    pub driver_phenotype_name: String,
    #[serde(rename = "driverPhenotypeWild")]
    pub driver_phenotype_wild: i64,
    #[serde(rename = "percentConversion")]
    pub percent_conversion: f64,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Hash, PartialEq, Eq, TS)]
#[ts(
    export,
    export_to = "../src/models/db/filter/db_AlleleConversionFieldName.ts"
)]
pub enum AlleleConversionFieldName {
    SourceAllele,
    ProductAllele,
    DriverPhenotypeName,
    DriverPhenotypeWild,
    PercentConversion,
    Description,
}

impl FieldNameEnum for AlleleConversionFieldName {
    fn get_col_name(&self) -> String {
        match self {
            AlleleConversionFieldName::SourceAllele => "source_allele".to_owned(),
            AlleleConversionFieldName::ProductAllele => "product_allele".to_owned(),
            AlleleConversionFieldName::DriverPhenotypeName => "driver_phenotype_name".to_owned(),
            AlleleConversionFieldName::DriverPhenotypeWild => "driver_phenotype_wild".to_owned(),
            AlleleConversionFieldName::PercentConversion => "percent_conversion".to_owned(),
            AlleleConversionFieldName::Description => "description".to_owned(),
        }
    }
}
