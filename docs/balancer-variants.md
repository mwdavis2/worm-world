# Entering balancer variants

A balancer or translocation (eT1, tmC5, nT1, ...) comes in many variants that
carry an extra marker or lethal, e.g. `eT1[let-500(s2165)]`. This is the
convention for entering them. It works within the current schema and needs no
code.

## The convention: one variation per balancer, variants as ordinary alleles

- Create **one variation** for the balancer (per chromosome half for a
  translocation), holding the suppressed range, position and chromosome. For
  eT1 these are `eT1(III)` and `eT1(V)`; see `translocations.md`.
- The plain balancer is an allele pointing at that variation.
- The variant's extra gene is entered as an **ordinary allele of that gene**
  (e.g. `let-500(s2165)`) and placed in the strain alongside the balancer, on
  the same homolog.

So `eT1 / eT1[let-500(s2165)]` is the balancer on one homolog together with
`let-500(s2165)` on the same chromosome, over the wild-type homolog. The
let-500 allele keeps its own phenotypes (lethality, markers) like any other
gene allele, and the card draws the balancer's region bracket around it
because it lies inside the balancer's range.

```
 III
 eT1      [ let-500(s2165) ]
 ──────   ──────────────────
 eT1(+)     let-500(+)
```

In a heterozygote the wild copy of the balancer is shown as `eT1(+)` (in every
allele display mode, for inversions and translocation halves alike). In a
strain where both copies are wild (`eT1(+)/eT1(+)`) the cell is left blank, and
other variations' wild copies follow the display mode as usual.

The balancer's range is stored once, so crossover suppression and the bracket
are computed from a single variation, and every strain using any eT1 variant
shares it.

## Why not a separate variation per variant

If each variant gets its own variation row (a second `eT1[...]` variation with
a copy of the range), the cross still works, because overlapping ranges are
merged. But each child also gets a stray wild `+/+` pair for the second
variation's locus, and the range has to be kept in sync in two places. When
entering demo or seed data, point every variant at the base variation.

## Alternative: put the variant in the balancer's name

The lighter-weight option is to skip the separate gene allele and make the
variant's text part of the balancer allele itself, e.g. an allele named or
described as `eT1[let-500(s2165)]`. It is quicker to enter, but the variant's
gene is then just text: it has no position, no phenotypes of its own and
cannot be filtered or crossed as a gene allele. Both approaches are allowed by
the schema; the collaborator's plan favours this one, the convention above is
the cleaner model.

## Double brackets

The card draws square brackets around the columns inside a balancer's range
(see the diagram above). If the balancer allele's own text also contains
brackets, e.g. a variation named `eT1[let-500(s2165)]` shown over mutant
alleles of other genes in the region, the card shows **two sets of brackets**:
the one from the allele's text and the region's. This is expected and not
a bug; the wild-type alleles in the region are drawn inside the region's
brackets either way. Contents text is shown exactly as stored, so the app
never adds or removes brackets in a name.

Example (variation named `eT1[let-500(s2165)]`, with `unc-36(e873)` on the
other homolog of a gene in the region):

```
 III
 eT1[let-500(s2165)]      [ unc-36(+) ]
 ──────────────────────   ─────────────
 eT1[let-500(s2165)](+)     unc-36(e873)
```

Here the first pair of brackets belongs to the name and the second marks the
balancer's region.
