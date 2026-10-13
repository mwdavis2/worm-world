# Crossing effects (phenotypes that change how a strain can be crossed)

Four boolean columns on the `phenotypes` table (Data Tables > Phenotypes) change the crossing mechanism itself:

| column | effect |
|---|---|
| `male_crossing_defective` | a **male** expressing it cannot be the male parent: the left crossing rectangle of its card turns black |
| `female_crossing_defective` | a **hermaphrodite** expressing it cannot be the hermaphrodite parent of a mated cross: the right rectangle turns black |
| `self_crossing_defective` | a hermaphrodite expressing it cannot self: the bottom rectangle turns black |
| `him` | a hermaphrodite expressing it loses the X from some of its eggs, so it makes males (see below) |

A black rectangle cannot start or receive a connection (its tooltip says why), and the right-click Cross / Self-cross items, the Cross drawer and notation paste refuse the cross with a plain message. The flags come from the phenotypes the card currently expresses, the same way "Lethal" does, so conditions, the parents' alleles and a mother's maternal phenotypes all count. A card that is already a parent keeps its cross.

**Settings** (Settings page):
- *Ignore crossing effects*: forces any cross regardless of the flags.
- *Him male frequency* (1-99%, default 37, the figure for him-8(e1489)): the share of a Him hermaphrodite's **eggs that carry no X** (X nondisjunction in oogenesis, which is where him-8 acts).

**How Him works.** Only the hermaphrodite parent's eggs change: with that chance an egg has no X. The sperm are as usual (a male's are half X, half X-less; a hermaphrodite's are all X).
- **Self cross:** an X-less egg fertilized by an X sperm is a male, so the share of males equals the setting (37%); the rest are hermaphrodites.
- **Cross to a male:** a normal egg gives a hermaphrodite (X sperm) or a male with the mother's X (X-less sperm), as always. An X-less egg fertilized by an X sperm gives a male whose single X is the **father's** (a patroclinous male); with an X-less sperm it makes nothing. The children are rescaled to total 1, so a Him mother gives more than the usual half males; at 37%, about 61% of the progeny are males and about 23% are males with the father's X.
- **No X-linked allele:** when neither parent has an X-linked allele there is no X to show, so crosses use an implicit wild X: a hermaphrodite's gametes all carry it and a male's are half X, half X-less. So a cross between such strains still gives half hermaphrodites and half males (a self cross, only hermaphrodites), and Him works the same way.
- **Left out:** the diplo-X eggs (about a fifth as many as the X-less ones; they give triplo-X hermaphrodites, a card cannot hold three X's), and the 90% drop in X recombination that him-8 causes. A Him male changes nothing.
- Source for the egg figures: Hodgkin, Horvitz & Brenner 1979 (Genetics 91:67); self-progeny about 37-40% males, about 6% triplo-X (Broverman & Meneely 1994).

**Setting the flags:** in the New Allele dialog (Advanced view), each phenotype row has a *Crossing Effects* button with a checkbox for each effect, next to *Lethal*; or edit the columns in the Phenotypes data table. An existing phenotype's flags are not changed from the dialog (a conflicting tick is refused, like Lethal).

**Filters:** a cross's filter has a "Filter by crossing effects" list (male / female / self crossing defective, Him, and "No crossing effects"). Nothing is hidden by default. A Him self cross starts with Male ticked in its sex filter so the males show.

**Migration:** `female_sterile` is replaced: `female_sterile = 1` becomes female *and* self crossing defective; a phenotype with `male_mating = 0` becomes male crossing defective (`male_mating` itself is kept for future work, as is `arrested`). CSV files that still have a `female_sterile` column import (the column is ignored); use the new header `name,wild,short_name,description,male_mating,lethal,male_crossing_defective,female_crossing_defective,self_crossing_defective,him,arrested,maturation_days`. The `conditions` table is unchanged.
