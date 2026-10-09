// Toggling a card between hermaphrodite and male must be reversible: the male
// remembers the hermaphrodite's X pair, including through a save and reload.
import { describe, expect, test } from 'vitest';
import { Allele } from 'models/frontend/Allele/Allele';
import { Strain } from 'models/frontend/Strain/Strain';
import { Variation } from 'models/frontend/Variation/Variation';
import { Sex } from 'models/enums';

const xAllele = (name: string): Allele =>
  new Allele({
    name,
    variation: new Variation({ name, chromosome: 'X' }),
  });

describe('Strain.toggleSex', () => {
  test('x1/+ -> male -> back is x1/+ again, not x1/x1', () => {
    const herm = new Strain({ allelePairs: [xAllele('x1').toTopHet()] });
    const male = herm.toggleSex();
    expect(male.sex).toBe(Sex.Male);
    expect(male.getAllelePairs().map((p) => p.isHomo())).toEqual([false]);
    const back = male.toggleSex();
    expect(back.sex).toBe(Sex.Hermaphrodite);
    expect(back.toString()).toBe(herm.toString());
    expect(back.hermXPair).toBeUndefined();
  });

  test('a het with the mutant on the bottom comes back the same', () => {
    const herm = new Strain({ allelePairs: [xAllele('x1').toBotHet()] });
    const back = herm.toggleSex().toggleSex();
    expect(back.toString()).toBe(herm.toString());
  });

  test('a compound heterozygote on X comes back the same', () => {
    const herm = new Strain({
      allelePairs: [
        xAllele('x1').toTopHet(),
        // a second locus on the same X, mutant on the other homolog
        xAllele('x2').toBotHet(),
      ],
    });
    const back = herm.toggleSex().toggleSex();
    expect(back.toString()).toBe(herm.toString());
  });

  test('the memory survives a JSON save and load', () => {
    const herm = new Strain({ allelePairs: [xAllele('x1').toTopHet()] });
    const male = Strain.fromJSON(herm.toggleSex().toJSON());
    expect(male.hermXPair).toBeDefined();
    expect(male.toggleSex().toString()).toBe(herm.toString());
  });

  test('a copied male keeps the memory', () => {
    const herm = new Strain({ allelePairs: [xAllele('x1').toTopHet()] });
    const male = herm.toggleSex();
    expect(male.clone().toggleSex().toString()).toBe(herm.toString());
    expect(new Strain({ ...male, isParent: true }).toggleSex().toString()).toBe(
      herm.toString()
    );
  });

  test('a male that was never a hermaphrodite becomes homozygous, as before', () => {
    const male = new Strain({
      sex: Sex.Male,
      allelePairs: [xAllele('x1').toTopHet()],
    });
    const herm = male.toggleSex();
    expect(herm.sex).toBe(Sex.Hermaphrodite);
    expect(herm.getAllelePairs().map((p) => p.isHomo())).toEqual([true]);
  });

  test("a remembered pair that no longer matches the male's X is ignored", () => {
    const herm = new Strain({ allelePairs: [xAllele('x1').toTopHet()] });
    const male = herm.toggleSex();
    // the male's X is now a different allele (an edit), so the memory is stale
    const edited = new Strain({
      ...male,
      allelePairs: undefined,
      chromPairMap: new Strain({
        sex: Sex.Male,
        allelePairs: [xAllele('x9').toTopHet()],
      }).chromPairMap,
    });
    const back = edited.toggleSex();
    expect(back.getAllelePairs().map((p) => p.isHomo())).toEqual([true]);
  });

  test('a strain with no X is unchanged except for its sex', () => {
    const herm = new Strain({ allelePairs: [] });
    const male = herm.toggleSex();
    expect(male.sex).toBe(Sex.Male);
    expect(male.hermXPair).toBeUndefined();
    expect(male.toggleSex().sex).toBe(Sex.Hermaphrodite);
  });
});
