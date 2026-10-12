# Plan: todo #35 - a "Conversion" tab in the New Allele dialog

> SAVED FOR LATER (user, 2026-10-12): planned and reviewed, NOT started. This file is overwritten by the next plan, so a copy belongs in the memory notes (linked from todo #35) and the repo docs. Build it only when the user says so.

## Context
Allele conversion rules (Cre/lox, FLP/FRT) can only be added on the Allele Conversions data-table tab or by CSV/zip import. Creating one by hand takes three steps (create the source allele, create the product allele with copies of the phenotype rows, add the rule). The user wants the New Allele dialog to do it in one step. Decisions (user, 2026-10-12):
- The conversion controls are their **own tab after Advanced** (Basic | Advanced | Conversion); no interaction with the Basic controls.
- The allele being created is always the **source**.
- The product starts as a **copy of the source's phenotype rows, with all their relations kept**; a conversion only REMOVES phenotypes (the dialog lets the user drop the ones the product loses). Anything else is edited on the data tables afterwards.
- The default product name is `*` + the source name (e.g. `*oxSi1308`), editable.
- The product must share the source's gene or variation (the rule the database enforces).

## How the dialog works today (read from `NewAlleleModal.tsx`)
- Three allele tabs (`gene`, `tiSiIs`, `ex`), each with its own state (`GeneTabState` / `VariationTabState`, `newAlleleTypes.ts`), and a Basic/Advanced switch (`activeView`).
- `handleCreate` builds the source allele (a gene allele, or a new `Variation` named after the allele plus the allele on it), inserts it with `insertAllele`, then `persistPhenotypeRows(allele.name, rows)`. **Which rows are saved depends on the view:** Basic uses `deriveRowsFromBasicState(...)`, Advanced uses `tab.phenotypeRows` (which `resyncGeneTab` / `resyncVariationTab` keep up to date with the live Basic-derived rows plus manual ones).
- The error toast is a generic "Make sure the name is not already in use".
- Dialog state is reset on each opening (`openCount` keys the body), so new state fields start fresh.

## Design

### State (`newAlleleTypes.ts`)
`ConversionState` on each tab state, default off:
`{ enabled, productName ('' = default '*' + source name), productContents ('' = same as the source's qualifiers), driverName, driverWild (default true), percent (default 100), description, dropped: string[] }`
- `dropped` holds phenotype keys (`name|wild`, the existing `phenotypeKey` form) the product loses; keys that no longer exist among the source's rows are ignored.
- Pure helpers (tested in `newAlleleTypes.test.ts`): `productNameFor(sourceName, state)`, `conversionRowsFor(rows, dropped)` (the source's named rows minus the dropped phenotypes, relations untouched), `conversionProblem(sourceName, state)` returning a plain sentence or `undefined` (empty driver, percent outside 0-100 or not a number, product name equal to the source or blank).

### The tab and the rows it copies (`NewAlleleModal.tsx`)
- `activeView` becomes `'basic' | 'advanced' | 'conversion'`; a third tab button after Advanced. A separate `phenotypeView` remembers the last of Basic/Advanced, and the **effective view for choosing rows to save is `phenotypeView` while Conversion is open**, so adding from the Conversion tab saves the same source rows the user last saw. The Conversion tab only READS those rows (no change to the Basic controls or to how they resync).
- The tab content (new `ConversionPanel.tsx`): an "This allele converts into another allele" checkbox; product name (placeholder `*name`), product qualifiers, driver phenotype name + "Wild-type" checkbox, "Percent converted (0-100)", description; a checklist "Phenotypes the product loses" with one checkbox per distinct (name, wild) phenotype among the source's rows (a note: "All relations are kept"); the problem sentence from `conversionProblem` under the form; fields disabled until the checkbox is ticked.
- `canCreate` also requires `conversionProblem(...) === undefined` when the section is enabled.
- **The "Phenotypes the product loses" list is live.** It is not stored: it is recomputed on every render from the same rows that would be saved (the Advanced tab's `phenotypeRows` when Advanced was last used, or the Basic-derived rows when Basic was), so adding, renaming or deleting a phenotype on Advanced changes the list at once, and an incomplete row (blank name) is left out. Only the ticks are stored, by phenotype key (`name|wild`): a tick stays with a phenotype while it exists, a deleted phenotype's tick is ignored, and a RENAMED phenotype shows as a new, unticked entry (the old tick no longer matches). Tested explicitly.

### Saving (`persistConversion.ts`, new; called from `handleCreate`)
Pre-flight (before anything is written, so a bad entry creates nothing): the product name is not an existing allele (`getAllele` lookup), the problem sentence is empty.
After the source allele and its rows are saved:
1. Insert the **product allele** on the source's gene (gene tab) or on the source's `Variation` (Ti/Si/Is and Ex tabs: the variation is named after the source and is not created again), with the product qualifiers (default: the source's).
2. `persistPhenotypeRows(productName, conversionRowsFor(rows, dropped))` - the source's rows without the dropped phenotypes, every relation kept.
3. Find-or-create the driver phenotype (the same minimal-phenotype helper `persistPhenotypeRows.ts` already uses for altering phenotypes), then `insertDbAlleleConversion` with the percent (0-100, as entered).
A failure after the source is saved reports it plainly ("The allele was added, but its conversion could not be created: <reason>") instead of the generic name message; the same accepted partial-failure edge `persistPhenotypeRows.ts` already documents.

### Small related fixes
- `isEcaAlleleName` (`Allele.ts`) ignores a leading `*`, so a product of an Ex array (`*oxEx12`) is still kept off the bottom-chromosome picker in the strain forms.
- `docs/allele-conversions.md` gets a section on the dialog tab; todo #35 is marked done.

## Reuse
`persistPhenotypeRows`, `phenotypeKey` and the find-or-create phenotype helper (`persistPhenotypeRows.ts`); `insertAllele` / `insertDbAlleleConversion` (`api/allele.ts`, `api/alleleConversion.ts`); `resyncGeneTab` / `resyncVariationTab` rows already kept live; the existing PhenotypeRow-style name + "Wild-type" layout; the backend checks (same locus, percent range) already return plain messages.

## Critical files
- modified: `src/components/NewAlleleModal/NewAlleleModal.tsx`, `newAlleleTypes.ts`, `src/models/frontend/Allele/Allele.ts`, `docs/allele-conversions.md`
- new: `src/components/NewAlleleModal/ConversionPanel.tsx`, `persistConversion.ts`, `persistConversion.test.ts`

## Assumptions (change if wrong)
- The product's qualifiers (contents) default to the source's and are editable.
- A driver phenotype that does not exist yet is created minimally (name, wild flag) so the rule can be saved; the user fills in the rest on the Phenotypes table.
- The product is not returned to the caller (`onCreated` still gets the source allele).

## Tests
- `newAlleleTypes.test.ts`: `productNameFor` (default `*name`, custom name), `conversionRowsFor` (drops a phenotype, keeps all relations, ignores stale keys), `conversionProblem` (each case).
- `persistConversion.test.ts` (mocked IPC): call order (product allele, product rows, driver phenotype, conversion); the product uses the source's gene or variation and inserts no variation of its own; dropped phenotypes are absent and every relation is copied; a taken product name or an invalid entry writes nothing; a failure after the source reports the partial-failure sentence.
- `NewAlleleModal.test.tsx`: the Conversion tab appears after Advanced; ticking the box enables the fields; an end-to-end Gene-tab and a Ti/Si/Is-tab create with a conversion (payloads); the Basic-view rows are the ones copied; Add is disabled for a bad percent or an empty driver; the dialog state resets on reopening (conversion back to off).
- `Allele` test for `isEcaAlleleName('*oxEx12')`.
- Full `npx vitest run`, `npx tsc --noEmit`, eslint (no Rust changes expected).

## Verification in `tauri dev`
1. New Allele > Ti/Si/Is: enter a made-up allele with a rescue phenotype on Advanced, open Conversion, tick it, accept `*name`, give driver `Cre` (wild), percent 90, drop the rescue phenotype, press Add.
2. Data tables: the product allele exists on the same variation with the source's rows minus the dropped phenotype and every relation; the Allele Conversions tab lists the rule at 90%.
3. A cross with a Cre-expressing parent converts (as in the oxSi1308 example). Delete the test alleles afterwards (the delete box lists the rule).
4. Gene and Ex tabs create too; a taken product name shows the plain message and creates nothing.
