# Genetics class designs

Two cross designs for each lab experiment, as importable design bundles:

| file | what it is |
|---|---|
| `labNN_before.ww.zip` | the strains the students use, as separate cards, ready to cross; they run the experiment in the designer |
| `labNN_key.ww.zip` | the answer key: the crosses as they should be designed |

`NN` is the lab number (01, 02, ...). Each experiment also has a folder `labNN/` with the source it was made from:

- `labNN/NOTES.md`: the experiment in a paragraph, the strains and alleles it needs (and any that are not in the seed), and what the key shows, with the expected progeny numbers.
- `labNN/before.txt`: one notation line per strain card of the before design.
- `labNN/key.txt`: the notation of the answer-key crosses (one line per cross tree).

## Making the two bundles from the notation

1. Open the cross designer on a new design and give it the experiment's name (for example "Lab 01 - before").
2. For each line of `before.txt`, copy it and use **Paste Notation** (right-click the canvas, or Cmd-V). Each line is one card. Put the cards where students can see them (Tidy up spreads overlapping ones).
3. Export it from the design card's menu with **Export design bundle** and save it as `labNN_before.ww.zip` here.
4. Do the same on a second new design with `key.txt` ("Lab 01 - key") and save `labNN_key.ww.zip`.
5. To check a design, import its bundle into a database with the lab's strains and open it.

A bundle carries the data tables its design uses (alleles, genes, phenotypes, strains), so students do not need the strains in their own database first.

## Notation, in short

`{locus locus ...}` is one card. A locus is `top/bottom`, with `+` for wild type and `0` for the missing second X of a male (so a male needs at least one X locus). A cross is `{{herm}{male}{child loci}}`, a self cross is `{{herm}{}{child loci}}`, and loci that are wild type on both chromosomes are left out. See `docs/` and `src/models/frontend/Notation/notationText.ts` for the full grammar.
