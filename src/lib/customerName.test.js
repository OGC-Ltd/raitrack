import { describe, it, expect } from 'vitest';
import { customerName } from './customerName';

describe('customerName', () => {
  it('capitals become a capital first letter, the company form stays (operator, 12 Nov 2026)', () => {
    expect(customerName('KAPU TECH LTD')).toBe('Kapu Tech LTD');
    expect(customerName('KAPU TECH KENYA LTD')).toBe('Kapu Tech Kenya LTD');
    expect(customerName('MAHADEV DRAPPERS')).toBe('Mahadev Drappers');
  });

  it('all lower case is set the same way', () => {
    expect(customerName('jalaram')).toBe('Jalaram');
    expect(customerName('chandarana supermarket Eldoret')).toBe('Chandarana Supermarket Eldoret');
  });

  it('a name typed in mixed case is kept as typed', () => {
    expect(customerName('Kapu Tech Kenya LTD')).toBe('Kapu Tech Kenya LTD');
    expect(customerName('McDonald Stores')).toBe('McDonald Stores');
  });

  it('codes, initials, (K) and words with digits stay; hyphens, apostrophes and small words read right', () => {
    expect(customerName('ABC (K) LTD')).toBe('Abc (K) LTD');
    expect(customerName('J K WHOLESALERS')).toBe('J K Wholesalers');
    expect(customerName('10023 KWA-GITARI SHOP 2B')).toBe('10023 Kwa-Gitari Shop 2B');
    expect(customerName("MAMA'S KITCHEN AND BAR")).toBe("Mama's Kitchen and Bar");
    expect(customerName('THE HUB')).toBe('The Hub');
    expect(customerName('NAKURU EPZ PLC')).toBe('Nakuru EPZ PLC');
  });

  it('spaces are tidied; nothing given stays nothing', () => {
    expect(customerName('  KWA   GITARI ')).toBe('Kwa Gitari');
    expect(customerName('')).toBe('');
    expect(customerName(null)).toBe(null);
    expect(customerName('-0.30139, 35.80982')).toBe('-0.30139, 35.80982');
  });
});
