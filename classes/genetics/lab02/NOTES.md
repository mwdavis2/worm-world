# Lab 02 - Experiment 2: Segregation and Independent Assortment

Handout: *Experiment 2: Segregation and Independent Assortment Lab Handout 2026 v1* (Week 2, Segregation / Mendel). A hermaphrodite homozygous for three unlinked recessive mutations (one per chromosome) is crossed to N2 males; single F1 cross-progeny are selfed and the F2 is counted for the mutant phenotypes (Bli, Dpy, Lon for EG1020; Dpy, Rol, Unc for MT3751) to test independent assortment.

## Strains

| strain | genotype | in the seed |
|---|---|---|
| N2 | wild type (the males) | - |
| EG1020 | bli-6(sc16) IV; dpy-11(e224) V; lon-2(e678) X | already |
| MT3751 | dpy-5(e61) I; rol-6(e187) II; unc-32(e189) III | **added for this lab**, with the unc-32(e189) allele and the Unc-32 phenotype |

Not added: CB1482 him-8(e1482), which the handout offers as a source of extra males (the seed has CB1489 him-8(e1489)).

**Check against the handout:** it names the dpy-11 allele **n224**; the seed's EG1020 (and its allele) is dpy-11(**e224**). I believe e224 is the standard dpy-11 allele, but I have not confirmed it against the strain's CGC page, so the designs use e224 and the handout may need the same correction.

The Unc-32 phenotype is ME0 for e189 in WormBase (C. elegans II: "ME0"; also "ES3 ME0 NA1"), so it is marked Male Mating 0 and **male crossing defective**, like the other ME0 unc phenotypes. It does not matter in this lab because MT3751 is the hermaphrodite parent.

## before.txt (the students' starting design)

Three cards, pasted one line each:

1. `{+/0}` - N2 male
2. `{e224/e224 sc16/sc16 e678/e678}` - EG1020 hermaphrodite
3. `{e61/e61 e187/e187 e189/e189}` - MT3751 hermaphrodite

## key.txt (the answer key: one tree per strain)

Each line is the whole experiment for one strain: N2 male x the triple-mutant hermaphrodite, one F1 cross-progeny **hermaphrodite** selfed, and the F2 child named at the end is the triple mutant.

| step | result |
|---|---|
| cross (Day 1) | F1 cross-progeny, 50% hermaphrodites / 50% males, all heterozygous for all three (the males of the EG1020 cross are lon-2/0) |
| self-cross of one F1 hermaphrodite (Day 2) | 27 F2 genotypes |
| F2 triple mutant | 1/64 = 1.5625% |

Expected F2 phenotype classes, by independent assortment (each locus 3 wild type : 1 mutant): all wild type 27/64; one mutant 9/64 each (27/64 together); two mutants 3/64 each (9/64 together); all three 1/64. For EG1020 lon-2 is on the X, but a selfing hermaphrodite gives only hermaphrodite F2 (no Him), so it assorts like the other two.

Checked with the app's own cross code (the numbers above, using the seed's gene positions: dpy-5 I, rol-6 II, unc-32 III, bli-6 IV, dpy-11 V, lon-2 X), and both lines decode to the F2 child they name. Not yet checked on screen: which phenotype lines each F2 card shows, and that the 27 children read clearly in the designer (the filters can narrow them).

The handout's discussion questions (why 8 plates on Day 2, the Strategy diagram) are not in the designer; the designs cover the crosses only.
