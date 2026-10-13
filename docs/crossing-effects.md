# Crossing effects (phenotypes that change how a strain can be crossed)

Four boolean columns on the `phenotypes` table (Data Tables > Phenotypes) change the crossing mechanism itself:

| column | effect |
|---|---|
| `male_crossing_defective` | a **male** expressing it cannot be the male parent: the left crossing rectangle of its card turns black |
| `female_crossing_defective` | a **hermaphrodite** expressing it cannot be the hermaphrodite parent of a mated cross: the right rectangle turns black |
| `self_crossing_defective` | a hermaphrodite expressing it cannot self: the bottom rectangle turns black |
| `him` | a hermaphrodite expressing it makes males when it selfs (see below) |

A black rectangle cannot start or receive a connection (its tooltip says why), and the right-click Cross / Self-cross items, the Cross drawer and notation paste refuse the cross with a plain message. The flags come from the phenotypes the card currently expresses, the same way "Lethal" does, so conditions, the parents' alleles and a mother's maternal phenotypes all count. A card that is already a parent keeps its cross.

**Settings** (Settings page):
- *Ignore crossing effects*: forces any cross regardless of the flags.
- *Him male frequency* (1-99%, default 33): the share of a Him hermaphrodite's self-cross children that are males. That share comes from an X-less sperm fertilizing an egg (one X, from the egg); the rest is the normal self cross. Autosomes recombine as usual. A mated cross with a Him parent is unchanged.

**Setting the flags:** in the New Allele dialog (Advanced view), each phenotype row has a *Crossing Effects* button with a checkbox for each effect, next to *Lethal*; or edit the columns in the Phenotypes data table. An existing phenotype's flags are not changed from the dialog (a conflicting tick is refused, like Lethal).

**Filters:** a cross's filter has a "Filter by crossing effects" list (male / female / self crossing defective, Him, and "No crossing effects"). Nothing is hidden by default. A Him self cross starts with Male ticked in its sex filter so the males show.

**Migration:** `female_sterile` is replaced: `female_sterile = 1` becomes female *and* self crossing defective; a phenotype with `male_mating = 0` becomes male crossing defective (`male_mating` itself is kept for future work, as is `arrested`). CSV files that still have a `female_sterile` column import (the column is ignored); use the new header `name,wild,short_name,description,male_mating,lethal,male_crossing_defective,female_crossing_defective,self_crossing_defective,him,arrested,maturation_days`. The `conditions` table is unchanged.
