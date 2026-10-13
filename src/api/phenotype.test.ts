import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, describe, expect, test } from 'vitest';
import { type db_Phenotype } from 'models/db/db_Phenotype';
import {
  insertDbPhenotype,
  updateDbPhenotype,
  withShortName,
} from 'api/phenotype';

const record = (shortName: string | null): db_Phenotype => ({
  name: 'ZzTable16',
  wild: false,
  shortName: shortName as string,
  description: null,
  maleMating: null,
  lethal: null,
  maleCrossingDefective: null,
  femaleCrossingDefective: true,
  selfCrossingDefective: true,
  him: null,
  arrested: null,
  maturationDays: null,
});

const sent: Array<{ cmd: string; phenotype: db_Phenotype }> = [];
const listen = (): void => {
  sent.length = 0;
  mockIPC((cmd, args) => {
    sent.push({
      cmd,
      phenotype: (args as { phenotype: db_Phenotype }).phenotype,
    });
  });
};

afterEach(() => {
  clearMocks();
});

describe('a phenotype with no short name', () => {
  test('the name stands in for a blank or missing short name', () => {
    expect(withShortName(record(null)).shortName).toBe('ZzTable16');
    expect(withShortName(record('')).shortName).toBe('ZzTable16');
    expect(withShortName(record('   ')).shortName).toBe('ZzTable16');
  });

  test('a short name that was given is kept', () => {
    const given = record('Zz16');
    expect(withShortName(given)).toBe(given);
  });

  test('is filled in when a phenotype is added or edited', async () => {
    listen();
    await insertDbPhenotype(record(null));
    await updateDbPhenotype(record(null));
    expect(sent.map((s) => s.cmd)).toEqual([
      'insert_phenotype',
      'update_phenotype',
    ]);
    sent.forEach((s) => {
      expect(s.phenotype.shortName).toBe('ZzTable16');
      // the crossing effects the form set are sent as they were
      expect(s.phenotype.femaleCrossingDefective).toBe(true);
      expect(s.phenotype.selfCrossingDefective).toBe(true);
    });
  });
});
