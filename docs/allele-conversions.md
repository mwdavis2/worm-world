# Allele conversions (Cre/lox, FLP/FRT, ...)

Some transgenes change when they pass through a germline that expresses a recombinase. Example: a floxed rescue transgene `loxP::unc-119(+)::loxP` rescues `unc-119(-)`; in a germline that expresses Cre the `unc-119(+)` is excised, so the progeny carry a loxP-only allele that no longer rescues.

WormWorld models this with **conversion rules**: "in a germline that expresses DRIVER, each copy of SOURCE becomes PRODUCT with probability PERCENT". The rules are applied when a cross is made (`Strain.crossWith`), before meiosis.

## The table (Data Tables > Allele Conversions)

| column | meaning |
|---|---|
| `sourceAllele` | the allele that converts (the floxed transgene) |
| `productAllele` | what it becomes (the loxP-only allele); an ordinary allele with its own phenotype rows |
| `driverPhenotypeName`, `driverPhenotypeWild` | the phenotype that has to be expressed in the germline, e.g. `Cre` with wild = 1 |
| `percentConversion` | chance, 0 to 100, that a copy converts when the driver is expressed (default 100, like `variations.percentLoss` it is a percent, not a 0-1 fraction) |
| `description` | a note |

- The **product must belong to the same gene or variation as the source**, so the two sit at one locus and linkage is unchanged. This is checked when a row is added or imported.
- The product is a separate allele with its own rows in Alleles and Allele Phenotypes. In the example the excised allele has no `Unc-119` (wild) row, so the existing rescue logic stops rescuing on its own.
- CSV headers (for **Import** and the zip import): `sourceAllele,productAllele,driverPhenotypeName,driverPhenotypeWild,percentConversion,description`. The table is imported after alleles and phenotypes.

## How a cross uses the rules

1. For each parent, a rule is **active** when the parent carries the source allele and the driver phenotype is among the phenotypes the parent expresses. In the cross designer that set is the parent card's phenotypes computed with its own parents' alleles, its cross's conditions and its mother (the same lookup the maternal-effect relations use), so a driver that exists only through the parent's parents or mother counts.
2. Each copy of a source allele (top or bottom chromosome, extrachromosomal arrays included) **independently** converts with the rule's chance, or stays. A male's single X is one copy; his absent second X is never a source.
3. The parent is expanded into the resulting weighted genotypes, each is crossed normally (meiosis, recombination, Ex arrays), and the children are merged once at the end. A converted copy sits at the same locus as the original, so recombination is unaffected.
4. **Several active rules on one copy** apply in order (product name, then driver), each acting on the copies the earlier ones left. Two drivers for the same product combine as independent chances.
5. **Chains** (A becomes B under Cre, B becomes C under Flp) are allowed, but one cross applies one pass: the product's own rules apply in the next cross.
6. A parent with too many convertible copies (more than 256 germline variants) is refused with a message, rather than freezing the app.

Because the rules depend only on the parents, the children are fixed when the cross is made. The filter's active conditions keep their meaning: they only change which children are shown.

## Limits (what is not modelled)

- Conversion in the parent's own body: the parent card keeps showing its own genotype and phenotype.
- Conditions as drivers (for example a heat-shock Cre): the driver has to be a phenotype the parent expresses. A driver whose own expression row needs a condition does not count as expressed in the cross.
- Inversions and FLEx switches: give the inverted state its own allele as the product.
- The driver should be an **explicit phenotype row** of the driver allele (for example `Cre` wild, expressed by the Cre allele). The wild-type background default can add a wild phenotype for a name an allele has an opinion about, so do not rely on it for a driver.

## Maternally loaded Cre: the placeholder pattern

Cre loaded into the F1 by the mother acts in the F1's germline; the converted alleles show up in the F2. Model it with a visible placeholder phenotype and an ordinary germline rule:

1. On the floxed allele add a phenotype row, for example `Cre-loaded` (non-wild, 1 or 2 copies) with the relationship **Requires Maternal Phenotype: `Cre`**.
2. Add the rule `floxed -> excised` with driver `Cre-loaded` (wild = 0).

A child of a Cre mother then shows `Cre-loaded` on its card, and when that child is crossed its germline converts the floxed copies (both parental copies). The child's own card keeps showing the floxed allele, because the conversion happens in its germline. If the child's own phenotype should change (the rescue lost in the F1), add a relation yourself, for example "Suppressed by Maternal Phenotype: `Cre`" on the rescue phenotype.

## Worked example (made-up alleles, for trying it)

An `unc-119(ed3)` strain rescued by a floxed transgene, and a germline Cre line. Import these rows (Data Tables > Import, or put them in a zip with the file names below). `ed3` and its `Unc-119` relation already exist in the seed data.

`variations.csv`
```csv
alleleName,chromosome,physLoc,geneticLoc,recombSuppressorStart,recombSuppressorEnd,isLocationReference,percentLoss
exFlox1,II,5000000,0.5,,,false,
exCre1,IV,6000000,1.5,,,false,
```

`phenotypes.csv`
```csv
name,wild,short_name,description,male_mating,lethal,female_sterile,arrested,maturation_days
Cre,1,Cre,germline Cre,,0,,,
```

`alleles.csv`
```csv
name,contents,sysGeneName,variationName
exFlox1,[loxP::unc-119(+)::loxP],,exFlox1
exFlox1d,[loxP],,exFlox1
exCre1,[Pmex-5::Cre],,exCre1
```

`allele_exprs.csv` (dominance 2 = "1 or 2 copies"; `Unc-119` wild already exists in the seed)
```csv
alleleName,expressingPhenotypeName,expressingPhenotypeWild,dominance
exFlox1,Unc-119,1,2
exCre1,Cre,1,2
```

`allele_conversions.csv`
```csv
sourceAllele,productAllele,driverPhenotypeName,driverPhenotypeWild,percentConversion,description
exFlox1,exFlox1d,Cre,1,100,excised by germline Cre
```

Try it: self a hermaphrodite `unc-119(ed3); exFlox1/exFlox1; exCre1/+`. The parent expresses Cre, so every copy of `exFlox1` converts in its germline and all the children are `exFlox1d/exFlox1d` (three quarters of them also carry `exCre1`); with the rescue gone the `Unc-119` phenotype returns. Without `exCre1` nothing converts. Set `percentConversion` to 50 to see a mix of `exFlox1`, `exFlox1/exFlox1d` and `exFlox1d/exFlox1d` children.

## Alternatives considered

- **A manual "Convert" node on the canvas**: rejected; conversion is automatic in the germline and should happen in every cross.
- **Driver = a specific allele** instead of a phenotype: rejected; phenotypes already carry the identity (the same way Flp is modelled) and let any line that expresses the recombinase drive it.
- **A flag on the Phenotype Relationships table**: rejected; that table's key and references (`expressing_phenotype_*`, a composite foreign key to allele phenotypes) mean something else, and relaxing them would touch most of the code that reads the table.
- **Maternal mode in the table itself**: rejected for the first version; the placeholder pattern above gives the same inheritance with no new column.
