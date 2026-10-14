# Plan: todo #37 - edit an allele in the New Allele dialog

> SAVED FOR LATER (user, 2026-10-14): planned, NOT started. Build only when the user says so. A copy lives in the memory notes (`project_worm_world_edit_allele_dialog_plan.md`).

## Context
The Strains table opens the full add/edit dialog (`AddStrainModal`, one component; a `strainToEdit` prop loads the row and the title becomes "Edit Strain"). The Alleles table only has the plain row editor (the name is a locked field), which cannot show the phenotype rows, relations or crossing effects. The user wants the same kind of link from the Alleles table to the New Allele dialog as an edit dialog.

Decisions (user, 2026-10-14): the edit dialog is the SAME component with an edit mode (reusing the code), not a copy. Everything else below is my proposed scope, to be confirmed when the work starts.

## How the dialog works today (read from the code)
- `NewAlleleModal.tsx` (1,329 lines): three allele tabs (`gene`, `tiSiIs`, `ex`), each with its own state (`GeneTabState` / `VariationTabState`, `newAlleleTypes.ts`), and a Basic / Advanced switch. State is initialised in an effect on open (`props.isOpen`, `props.initialName`), shaped around "new allele".
- Advanced shows `phenotypeRows: PhenotypeRowState[]`. Each row is nearly one `allele_expr` row (copy number -> `dominance`, phenotype name + wild, lethal, the four crossing effects) plus at most one relation (relationship kind + text -> an `expr_relations` row). So Advanced is a near-direct picture of the stored rows.
- Basic controls (resistant to drug, dominance, rescues gene, fluorescent marker) generate rows one way (`computeResistantToDrugRows`, ...; tagged `derivedFrom`). Different control settings can produce the same rows, so the controls cannot be reliably rebuilt from stored rows.
- `handleCreate` inserts the allele (`insertAllele`; with a new `Variation` for Ti/Si/Is and Ex) then `persistPhenotypeRows(alleleName, rows)` (find-or-create each phenotype, insert allele_exprs, then relations).
- The Alleles table (`pages/data-tables/alleles.tsx`) uses `updateRow={updateDbAllele}` and `lockedFields={['name']}`: a rename is not offered there (the name is the key other tables point at).

## Scope (proposed)
1. An **Edit** button on each Alleles table row (like the Strains table's) opening the dialog on that allele.
2. **Advanced view only** in edit mode (Basic hidden), because Basic cannot be rebuilt from stored rows.
3. The allele's **gene or variation shown read-only** (other alleles may use it; editing it is a different job).
4. The **name read-only** (matches the table; avoids cascading a rename through strain_alleles, allele_exprs, expr_relations and conversions).
5. Saving **replaces the allele's phenotype rows** (expressions and relations) and updates the allele's own fields (contents).
Out of scope: Basic view in edit mode, renaming, editing the gene/variation, the Conversion tab (#35), deleting phenotypes left unused (the Phenotypes table already tints unused rows).

## Design

### 1. Extract the Advanced pane first
Pull the Advanced phenotype-row editor out of `NewAlleleModal.tsx` into its own component (props: rows, setRows, gene name for display, read-only flags). Both the entry and edit dialogs use it, so a later fix lands in both. Pure move, with the existing `NewAlleleModal.test.tsx` tests passing unchanged as the safety net. Do this as its own commit before any edit work.

### 2. Loading (`loadAlleleForEdit.ts`, new, pure + one API read)
Given an allele name, read: the allele, its gene or variation, its `allele_exprs` rows (filter by allele name), and the `expr_relations` for that allele; join with the phenotype rows (lethal, crossing effects). Map to `PhenotypeRowState[]`:
- one row per allele_expr (copy number from `dominance` via the inverse of `zygosityToDominance`; name, wild, lethal, crossing effects from the phenotype);
- one extra row per additional relation of the same phenotype (the existing "several rows per phenotype, one relation each" form), or one row with the first relation;
- relationship kind from (`is_suppressing`, `altering_phenotype_wild`, `altering_phenotype_maternal`, condition vs phenotype) via the inverse of the relationship helpers in `newAlleleTypes.ts`.
Tested as a round trip: rows -> `persistPhenotypeRows` -> `loadAlleleForEdit` returns equal rows, for every relationship kind and maternal/condition variants.

### 3. The modal in edit mode
`NewAlleleModal` gets `alleleToEdit?: db_Allele`. When set: skip the new-allele init effect and load state from `loadAlleleForEdit`; select the matching tab (gene vs Ti/Si/Is vs Ex) and lock it; hide the Basic/Advanced switch (Advanced only); title "Edit Allele"; primary button "Save" (not "Add"); name, gene/variation fields disabled. The name-taken check and `canCreate` name rules are skipped in edit mode.

### 4. Saving (`replaceAllelePhenotypeRows` in `persistPhenotypeRows.ts`)
In order, so a failure part-way is reported plainly:
1. Validate with the same checks `persistPhenotypeRows` runs (conflicting copy numbers, duplicate relations) BEFORE deleting anything, so a bad edit changes nothing.
2. Delete the allele's `expr_relations`, then its `allele_exprs` (`deleteFilteredExpressionRelations` / `deleteFilteredAlleleExpressions` with a filter on the allele name). To verify: the foreign keys (relations reference allele_exprs) and whether a Rust-side transaction is available; if the deletes and re-inserts can be done in one transaction, add a small Rust command (`replace_allele_phenotypes`) for it, otherwise accept the same partial-failure edge `persistPhenotypeRows.ts` already documents and say so in the error toast.
3. Call `persistPhenotypeRows(name, rows)`.
4. `updateDbAllele` for contents if changed.
Phenotype rows (the `phenotypes` table) are shared and are only find-or-created, never edited here; a changed lethal/crossing flag on an EXISTING phenotype is flagged to the user ("this phenotype is shared: edit it on the Phenotypes table") rather than silently ignored. (Decide when building: block, or warn.)

### 5. The table link
`alleles.tsx`: `customRowActions` Edit button -> `setEditingAllele(row)` -> `NewAlleleModal alleleToEdit=...`; refresh the table on save (the same `refreshRef` pattern as `strains.tsx`).

## Tests
- Round-trip load/persist test (above); each relationship kind; an allele with no phenotype rows; a variation allele (Ex and Ti/Si/Is).
- Edit mode: the modal opens in Advanced with the rows loaded; name and gene fields disabled; Save replaces the rows (assert the old rows are gone and the new ones present); a failed validation leaves the old rows.
- Shared phenotype: editing one allele's rows leaves another allele using the same phenotype untouched.
- Rust (if a replace command is added): replace in one transaction, rollback on a bad row.
- Existing suites unchanged (`npx vitest run`, `tsc`, eslint, `cargo test`).

## Open questions (ask when starting)
- Block or warn when an edit changes a flag on a shared phenotype?
- Is a Rust transaction wanted, or is the plain partial-failure edge acceptable (as for Add)?
- Should Basic ever come back in edit mode (e.g. only for alleles whose rows exactly match what the controls would generate)? I'd say no.

## Estimate
About a day: the Advanced-pane extraction (small, mechanical), load/round-trip (medium), the replace-save with its tests (medium, the risky part), the table button (small).
