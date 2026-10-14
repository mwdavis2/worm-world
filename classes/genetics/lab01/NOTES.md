# Lab 01 - Experiment 1: X-linked Traits

Handout: *Experiment 1: X-linked Traits Lab Handout 2026 v1* (Week 1, Darwin v Mendel). Wild-type (N2) males are crossed to hermaphrodites homozygous for one of three recessive mutations, two on the X (lin-15, kin-20) and one not (unc-44, chromosome IV); the F1 shows how X-linked and autosomal recessives differ.

## Strains (all in the seed)

| strain | genotype | notes |
|---|---|---|
| N2 | wild type | the males |
| MT1642 | lin-15(n765ts) X | temperature sensitive: wild type at 15C, multivulva at 25C |
| EG423 | kin-20(ox423) X | weakly Unc; kin-20 promotes unc-44 expression |
| EG10297 | oxSi1274 II; unc-44(e362) IV | paralyzed, small, slow ("extra" Unc); oxSi1274 is the GABA-neuron marker Punc-47::mKate2 |

`e362` (unc-44), `oxSi1274` (the mKate marker) and the three mutant strains were added to the seed for this lab; its Unc-44 phenotype is male crossing defective (ME0 in WormBase, M-MATING-NO SUCCESS in the CGC), which does not matter here because the hermaphrodite is the mutant parent.

## before.txt (the students' starting design)

Four cards, pasted one line each:

1. `{+/0}` - N2 male
2. `{n765ts/n765ts}` - MT1642 hermaphrodite
3. `{ox423/ox423}` - EG423 hermaphrodite
4. `{oxSi1274/oxSi1274 e362/e362 +/+}` - EG10297 hermaphrodite

## key.txt (the answer key: three crosses)

Each line is one cross of an N2 male to a mutant hermaphrodite. The child named at the end is a male, so the male half of the F1 shows without touching the sex filter (the hermaphrodite half always shows).

| cross | F1 hermaphrodites | F1 males |
|---|---|---|
| N2 male x MT1642 | n765ts/+ , 50% | n765ts/0 , 50% |
| N2 male x EG423 | ox423/+ , 50% | ox423/0 , 50% |
| N2 male x EG10297 | oxSi1274/+ ; e362/+ , 50% | oxSi1274/+ ; e362/+ , 50% |

Checked with the app's own cross code (the numbers above), and each line decodes to the child it names.

What it should show on screen (phenotypes, from the seed data; confirm when you open the design):

- **lin-15 (X-linked):** the hermaphrodites are heterozygous and wild type; the males carry the mutant X from their mother and are mutant (multivulva at 25C). Turn on the **25C** condition in the cross's filter to see Lin-15 on the males.
- **kin-20 (X-linked):** the same pattern, with Kin shown on the males only.
- **unc-44 (not X-linked):** every child, of both sexes, is heterozygous and wild type for unc-44; nothing is mutant in F1. oxSi1274 is a marker, not a mutant: every child carries one copy and shows the GABA::mKate marker (the seed expresses it with one or two copies).

The questions at the end of the handout (what if the mutation is not on the X, or is dominant) are answered by comparing the unc-44 cross with the other two.
