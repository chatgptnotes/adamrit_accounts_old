import { describe, it, expect } from 'vitest';
import {
  medicineKeywords,
  matchMedicineName,
  medicineSearchFilter,
  type MasterMedicine,
} from '../medicineNameMatch';

// The real rows behind Rahmat Hussain's prescription RX-1787032198758, which
// showed "Stock: unknown" on six of nine items on 19 Aug.
const master: MasterMedicine[] = [
  { id: 'ns', medicine_name: 'NS 500 ML I.V.- SODIUM CHLORIDE 500 ML INJ' },
  { id: 'tazar', medicine_name: 'TAZAR 4.5 GM INJ', generic_name: 'PIPERACILLIN TAZOBACTAM' },
  { id: 'carbo', medicine_name: 'CARBOPHAGE 500 TAB', generic_name: 'METFORMIN 500 MG' },
  { id: 'opti', medicine_name: 'OPTINEURON 2ML INJ', generic_name: 'VITAMIN B COMPLEX' },
  { id: 'sporlac', medicine_name: 'SPORLAC-DS TAB(LACTIC ACID BACILLUS TAB)' },
  { id: 'atv1', medicine_name: 'ATOVASTRIN 40 MG- ATORVASTATIN 40 MG TAB' },
  { id: 'atv2', medicine_name: 'ATORBEST 40 MG TAB -ATORVASTATIN 40 MG' },
];

describe('medicineKeywords', () => {
  it('drops the dosage form and keeps the drug', () => {
    expect(medicineKeywords('INJ TAZAR')).toEqual(['tazar']);
    expect(medicineKeywords('TAB CARBOPHAGE')).toEqual(['carbophage']);
  });

  it('drops pure numbers and number-unit blobs', () => {
    expect(medicineKeywords('100ML NS')).toEqual([]);
    expect(medicineKeywords('Metformin 500')).toEqual(['metformin']);
  });

  it('returns nothing for a two-letter abbreviation, rather than guessing', () => {
    expect(medicineKeywords('Mr')).toEqual([]);
    expect(medicineKeywords('Sp')).toEqual([]);
  });

  it('orders by length, so the strongest claim is tried first', () => {
    expect(medicineKeywords('Rabisec DSR tab')).toEqual(['rabisec']);
    expect(medicineKeywords('SPORLAC-DS TAB(LACTIC ACID BACILLUS TAB)'))
      .toEqual(['bacillus', 'sporlac', 'lactic', 'acid']);
  });
});

describe('matchMedicineName', () => {
  it('matches the identical name, which is all the old code could do', () => {
    const m = matchMedicineName('NS 500 ML I.V.- SODIUM CHLORIDE 500 ML INJ', master);
    expect(m.confidence).toBe('exact');
    expect(m.medicine?.id).toBe('ns');
  });

  it('resolves the short forms that used to read "Stock: unknown"', () => {
    expect(matchMedicineName('INJ TAZAR', master).medicine?.id).toBe('tazar');
    expect(matchMedicineName('TAB CARBOPHAGE', master).medicine?.id).toBe('carbo');
    expect(matchMedicineName('INJ OPTINEURON', master).medicine?.id).toBe('opti');
  });

  it('finds a medicine by its molecule, whatever the brand', () => {
    const m = matchMedicineName('Metformin 500', master);
    expect(m.confidence).toBe('single');
    expect(m.medicine?.id).toBe('carbo');
  });

  it('refuses to choose between two brands of one molecule', () => {
    const m = matchMedicineName('Atorvastatin 40', master);
    expect(m.confidence).toBe('ambiguous');
    expect(m.medicine).toBeNull();
    expect(m.candidates.map((c) => c.id).sort()).toEqual(['atv1', 'atv2']);
  });

  it('says none rather than guessing when the name identifies nothing', () => {
    expect(matchMedicineName('Mr', master).confidence).toBe('none');
    expect(matchMedicineName('100ML NS', master).confidence).toBe('none');
    expect(matchMedicineName('', master).confidence).toBe('none');
  });
});

describe('medicineSearchFilter', () => {
  it('searches the product name and the generic name', () => {
    expect(medicineSearchFilter('INJ TAZAR')).toBe(
      'medicine_name.ilike.%tazar%,generic_name.ilike.%tazar%',
    );
  });

  it('is null when there is nothing to search on', () => {
    expect(medicineSearchFilter('Mr')).toBeNull();
    expect(medicineSearchFilter('100ML')).toBeNull();
  });
});
