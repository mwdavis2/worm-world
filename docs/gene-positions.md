# Gene positions and where the gene data comes from

Every gene row has a chromosome, a physical position (bp) and a genetic
position (cM). Crossover suppression and the balancer-region brackets compare
a gene's **physical** position with a rearrangement's physical range, so every
gene we can place has one.

## Source

All of the gene data below comes from the WormBase annotation downloads:
<https://downloads.wormbase.org/species/c_elegans/annotation/>

The files live in `data/wormbase/` and are turned into importable CSVs by
`node scripts/build-uncloned-genes.mjs`.

| File | What it gives |
|---|---|
| `c_elegans.canonical_bioproject.current.geneIDs.txt.gz` | WBGene id, public name, sequence name, status, biotype. A live gene with a public name and **no sequence name** is an uncloned gene. |
| `c_elegans.PRJNA13758.current.geneOtherIDs.txt.gz` | One "other name" per gene (the synonyms, e.g. `syx-1` for `unc-64`). It carries at most one other name per gene, so a gene's further synonyms are simply absent. |
| `c_elegans.WS225.genetic_limits.gff2` | Genetic-map positions (an older release, WS225) for 7,058 genes: a cM value for each, and for the 1,005 uncloned ones an interpolated physical span. It covers 877 of the 1,513 current uncloned genes. |

The cloned genes already in the app (`src-tauri/seed/genes.csv`) each have both
a physical and a cM position.

## Positions that are interpolated

**A gene without a systematic name has an interpolated position.** An uncloned
gene is mapped only by recombination, so it has no sequence and no true
physical coordinate.

- **Uncloned genes** (`data/wormbase/uncloned_genes.csv`, 876 genes) are keyed
  by their public name (no systematic name). Their genetic position is the cM
  from the map file, and their physical position is the **midpoint of the
  interpolated span** WormBase gives for them (about 70 kb wide, so roughly
  ±35 kb). Treat it as a position on the genetic map, not a coordinate.
- **Placeholder genes** (`data/wormbase/placeholder_genes.csv`, 10 rows) stand
  in for the unknown genes of translocation-balancer variants, such as
  `let-?(s1799)` or `let-500(s2165)`. Which half of the balancer carries the
  gene is not known, so each is placed arbitrarily on the first half, at the
  junction of that half's suppressed range. Real positions can replace these
  if they become known.
- **Genes with no data** (`data/wormbase/genes_pending_positions.csv`, 673
  rows) have no position in any of the files, so they are not imported. That
  covers 636 uncloned genes and 37 live sequence names missing from the table
  (tRNA, rRNA and similar). They need a position source before they can be
  used.

## Synonyms

A synonym is stored as an extra gene row with the **same position** as the
gene it names. Because a cloned gene is keyed by its systematic name, the
synonym row's key is `<systematic name> (<synonym>)`, the same shape as the
existing `ZC416.8 (unc-17)` row: `F56A8.7 (syx-1)` is `unc-64`'s position under
the name `syx-1`.

Only gene-style names (`abc-1`) of cloned genes are included
(`data/wormbase/gene_synonyms.csv`, 1,471 rows). A synonym is skipped when it
already is a gene name (the existing gene wins), when it belongs to more than
one gene, or when it names an uncloned gene.

## Limits

- A synonym row is a separate row, not a link: it appears next to its gene, and
  editing one does not change the other.
- The interpolated physical positions are only as good as the genetic map; use
  them to order genes and to judge whether they sit inside a balancer's range,
  not for fine mapping.
