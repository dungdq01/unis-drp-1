import { TransportMultiDropService, RawTrip } from './transport.multi-drop.service';

describe('TransportMultiDropService', () => {
  const svc = new TransportMultiDropService();
  const vehicle = { maxPallets: 20, maxWeightKg: 10_000 };

  function mkTrip(dest: string, pallets: number, weight: number): RawTrip {
    return {
      sourceLocationCode: 'HUB',
      destLocationCode: dest,
      totalPallets: pallets,
      totalWeightKg: weight,
      items: [{ itemCode: `SKU-${dest}`, qty: pallets * 10, weightKg: weight, pallets, sourceAllocationLegId: null, allocationResultId: 'R0' }],
    };
  }

  describe('computeFillRatio', () => {
    it('returns MAX(pallet_pct, weight_pct)', () => {
      expect(svc.computeFillRatio(18, 5000, vehicle)).toBeCloseTo(0.9, 2); // pallets dominate
      expect(svc.computeFillRatio(10, 9000, vehicle)).toBeCloseTo(0.9, 2); // weight dominates
      expect(svc.computeFillRatio(0, 0, vehicle)).toBe(0);
    });
  });

  describe('consolidate', () => {
    it('US-1 single full trip = no consolidation', () => {
      const trips = [mkTrip('BD', 18, 8000)];
      const distance = new Map([['HUB|BD', 50]]);
      const out = svc.consolidate(trips, vehicle, distance);
      expect(out).toHaveLength(1);
      expect(out[0].isMultiDrop).toBe(false);
      expect(out[0].stops).toHaveLength(1);
    });

    it('US-6 multi-drop consolidation with nearest-neighbor order', () => {
      const trips = [
        mkTrip('BD', 5, 1000),
        mkTrip('CT', 4, 800),
        mkTrip('VT', 3, 600),
      ];
      // HUB → BD (nearest) → CT → VT
      const distance = new Map([
        ['HUB|BD', 30], ['HUB|CT', 80], ['HUB|VT', 100],
        ['BD|CT', 40], ['BD|VT', 60],
        ['CT|VT', 30],
        ['BD|CT', 40], ['CT|BD', 40],
        ['BD|VT', 60], ['VT|BD', 60],
        ['CT|VT', 30], ['VT|CT', 30],
      ]);
      const out = svc.consolidate(trips, vehicle, distance);
      expect(out).toHaveLength(1);
      expect(out[0].isMultiDrop).toBe(true);
      expect(out[0].stops).toHaveLength(3);
      expect(out[0].stops[0].locationCode).toBe('BD'); // nearest from HUB
      expect(out[0].stops[1].locationCode).toBe('CT'); // nearest from BD
      expect(out[0].stops[2].locationCode).toBe('VT'); // nearest from CT
      expect(out[0].totalPallets).toBe(12);
    });

    it('US-7 split into 2 trips when capacity exceeded', () => {
      const trips = [
        mkTrip('BD', 9, 2000),
        mkTrip('CT', 9, 2000),
        mkTrip('VT', 9, 2000),
      ];
      // All within 200km → same group, but 27 pallets > 20 capacity
      const distance = new Map([
        ['HUB|BD', 30], ['HUB|CT', 80], ['HUB|VT', 100],
        ['BD|CT', 40], ['CT|BD', 40],
        ['BD|VT', 60], ['VT|BD', 60],
        ['CT|VT', 30], ['VT|CT', 30],
      ]);
      const out = svc.consolidate(trips, vehicle, distance);
      // 2 trips: first fills up (9+9=18), second carries remaining 9
      expect(out.length).toBeGreaterThanOrEqual(2);
    });

    it('groups dests only within pairwise distance threshold (H3)', () => {
      // BD-CT 40km (group), VT-BD 500km (far → separate group)
      const trips = [
        mkTrip('BD', 5, 1000),
        mkTrip('CT', 4, 800),
        mkTrip('VT', 3, 600),
      ];
      const distance = new Map([
        ['HUB|BD', 30], ['HUB|CT', 80], ['HUB|VT', 600],
        ['BD|CT', 40], ['CT|BD', 40],
        ['BD|VT', 500], ['VT|BD', 500],
        ['CT|VT', 480], ['VT|CT', 480],
      ]);
      const out = svc.consolidate(trips, vehicle, distance, 200);
      // BD+CT grouped; VT alone
      expect(out.length).toBe(2);
      const multiDropTrip = out.find((t) => t.isMultiDrop)!;
      expect(multiDropTrip.stops.map((s) => s.locationCode).sort()).toEqual(['BD', 'CT']);
      const singleTrip = out.find((t) => !t.isMultiDrop)!;
      expect(singleTrip.stops[0].locationCode).toBe('VT');
    });

    it('maps each item to its correct stop (C3)', () => {
      const trips = [mkTrip('BD', 3, 600), mkTrip('CT', 2, 400)];
      const distance = new Map([
        ['HUB|BD', 30], ['HUB|CT', 80],
        ['BD|CT', 40], ['CT|BD', 40],
      ]);
      const out = svc.consolidate(trips, vehicle, distance);
      expect(out[0].itemStopMapping).toHaveLength(2);
      expect(out[0].itemStopMapping[0]).toBe('BD');
      expect(out[0].itemStopMapping[1]).toBe('CT');
    });
  });
});
