import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';

import { MasterDataService } from './master-data.service';
import { Sku } from './entities/sku.entity';
import { SkuVariant } from './entities/sku-variant.entity';
import { Channel } from './entities/channel.entity';
import { Supplier } from './entities/supplier.entity';
import { Hub } from './entities/hub.entity';
import { SkuNmMapping } from './entities/sku-nm-mapping.entity';
import { SkuCnMapping } from './entities/sku-cn-mapping.entity';
import { HubCnCluster } from './entities/hub-cn-cluster.entity';
import { HubNmAssignment } from './entities/hub-nm-assignment.entity';
import { Customer } from './entities/customer.entity';
import { CustomerCn } from './entities/customer-cn.entity';
import { MasterDataAuditLog } from './entities/master-data-audit-log.entity';

// ─── Shared mocks ─────────────────────────────────────────────────────────────

const mockRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn(() => ({
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
  })),
});

const buildMockEm = (overrides: Record<string, jest.Mock> = {}) => ({
  findOne: jest.fn(),
  find: jest.fn().mockResolvedValue([]),
  save: jest.fn((_, entity) => Promise.resolve(entity)),
  create: jest.fn((_, data) => data),
  update: jest.fn(),
  query: jest.fn().mockResolvedValue([]),
  ...overrides,
});

const buildDataSource = (emOverrides: Record<string, jest.Mock> = {}) => {
  const em = buildMockEm(emOverrides);
  return {
    transaction: jest.fn((fn) => fn(em)),
    query: jest.fn().mockResolvedValue([{ count: '0' }]),
    _em: em,
  };
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MasterDataService', () => {
  let service: MasterDataService;

  const makeService = async (dsOverrides: Record<string, jest.Mock> = {}) => {
    const ds = buildDataSource(dsOverrides);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MasterDataService,
        { provide: DataSource, useValue: ds },
        { provide: getRepositoryToken(Sku), useValue: mockRepo() },
        { provide: getRepositoryToken(SkuVariant), useValue: mockRepo() },
        { provide: getRepositoryToken(Channel), useValue: mockRepo() },
        { provide: getRepositoryToken(Supplier), useValue: mockRepo() },
        { provide: getRepositoryToken(Hub), useValue: mockRepo() },
        { provide: getRepositoryToken(SkuNmMapping), useValue: mockRepo() },
        { provide: getRepositoryToken(SkuCnMapping), useValue: mockRepo() },
        { provide: getRepositoryToken(HubCnCluster), useValue: mockRepo() },
        { provide: getRepositoryToken(HubNmAssignment), useValue: mockRepo() },
        { provide: getRepositoryToken(Customer), useValue: mockRepo() },
        { provide: getRepositoryToken(CustomerCn), useValue: mockRepo() },
        { provide: getRepositoryToken(MasterDataAuditLog), useValue: mockRepo() },
      ],
    }).compile();
    return { service: module.get<MasterDataService>(MasterDataService), ds };
  };

  // ── createSku ──────────────────────────────────────────────────────────────

  describe('createSku', () => {
    it('throws BadRequestException when supplier not found', async () => {
      const { service, ds } = await makeService();
      (ds as any)._em.findOne.mockImplementation((entity: unknown) => {
        if (entity === Supplier) return Promise.resolve(null);
        return Promise.resolve(null);
      });

      await expect(
        service.createSku({ skuCode: 'S01', skuName: 'Test', nmCode: 'NM99', moq: 0 } as any, 'user1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when sku_code already exists', async () => {
      const { service, ds } = await makeService();
      (ds as any)._em.findOne.mockImplementation((entity: unknown) => {
        if (entity === Supplier) return Promise.resolve({ supplierCode: 'NM01', status: 'ACTIVE' });
        if (entity === Sku) return Promise.resolve({ id: '1', skuCode: 'S01' }); // exists
        return Promise.resolve(null);
      });

      await expect(
        service.createSku({ skuCode: 'S01', skuName: 'Test', nmCode: 'NM01', moq: 0 } as any, 'user1'),
      ).rejects.toThrow(ConflictException);
    });

    it('creates sku + nm_mapping + audit in single transaction', async () => {
      const { service, ds } = await makeService();
      const em = (ds as any)._em;
      let findCallCount = 0;
      em.findOne.mockImplementation((entity: unknown) => {
        findCallCount++;
        if (entity === Supplier) return Promise.resolve({ supplierCode: 'NM01', status: 'ACTIVE' });
        if (entity === Sku && findCallCount === 2) return Promise.resolve(null); // no duplicate
        return Promise.resolve(null);
      });
      em.save.mockImplementation((_: unknown, data: unknown) => Promise.resolve({ ...(data as object), id: '42' }));

      const result = await service.createSku(
        { skuCode: 'S01', skuName: 'Test SKU', nmCode: 'NM01', moq: 100 } as any,
        'user1',
      );

      expect(result).toMatchObject({ id: '42' });
      expect(ds.transaction).toHaveBeenCalledTimes(1);
    });
  });

  // ── deactivateSku ──────────────────────────────────────────────────────────

  describe('deactivateSku', () => {
    it('throws NotFoundException when sku not found', async () => {
      const { service, ds } = await makeService();
      (ds as any)._em.findOne.mockResolvedValue(null);

      await expect(service.deactivateSku('999', 'user1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when sku already inactive', async () => {
      const { service, ds } = await makeService();
      (ds as any)._em.findOne.mockResolvedValue({ id: '1', active: false });

      await expect(service.deactivateSku('1', 'user1')).rejects.toThrow(BadRequestException);
    });

    it('deactivates sku + mappings atomically (BUG-4 fix: no em.update)', async () => {
      const { service, ds } = await makeService();
      const em = (ds as any)._em;
      em.findOne.mockResolvedValue({ id: '1', active: true, updatedBy: null });
      em.find.mockResolvedValue([{ id: '10', active: true }]);

      await service.deactivateSku('1', 'user1');

      // find was called for mappings (BUG-4: uses find+save not update)
      expect(em.find).toHaveBeenCalledWith(SkuNmMapping, { where: { skuId: '1', active: true } });
    });
  });

  // ── changeSkuNm ────────────────────────────────────────────────────────────

  describe('changeSkuNm', () => {
    it('deactivates old mapping and inserts new one (BUG-3 fix)', async () => {
      const { service, ds } = await makeService();
      const em = (ds as any)._em;
      const oldMapping = { id: '10', nmCode: 'NM01', active: true, moq: 50 };

      em.findOne.mockImplementation((entity: unknown) => {
        if (entity === Sku) return Promise.resolve({ id: '1', active: true });
        if (entity === Supplier) return Promise.resolve({ supplierCode: 'NM02', status: 'ACTIVE' });
        if (entity === SkuNmMapping) return Promise.resolve(oldMapping);
        return Promise.resolve(null);
      });
      em.save.mockImplementation((_: unknown, data: unknown) => Promise.resolve({ ...(data as object), id: '11' }));

      await service.changeSkuNm('1', { nmCode: 'NM02', reason: 'Better lead time' }, 'user1');

      // Old mapping must be deactivated
      expect(em.save).toHaveBeenCalledWith(SkuNmMapping, expect.objectContaining({ active: false }));
      // New mapping must be created
      expect(em.create).toHaveBeenCalledWith(SkuNmMapping, expect.objectContaining({ nmCode: 'NM02', active: true }));
    });

    it('throws BadRequestException when already mapped to same supplier', async () => {
      const { service, ds } = await makeService();
      const em = (ds as any)._em;
      em.findOne.mockImplementation((entity: unknown) => {
        if (entity === Sku) return Promise.resolve({ id: '1', active: true });
        if (entity === Supplier) return Promise.resolve({ supplierCode: 'NM01', status: 'ACTIVE' });
        if (entity === SkuNmMapping) return Promise.resolve({ nmCode: 'NM01', active: true });
        return Promise.resolve(null);
      });

      await expect(
        service.changeSkuNm('1', { nmCode: 'NM01', reason: 'same supplier' }, 'user1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── ltOverride ─────────────────────────────────────────────────────────────

  describe('ltOverride', () => {
    it('increments lt_drift_count and sets lt_drift_last_at', async () => {
      const { service, ds } = await makeService();
      const em = (ds as any)._em;
      const supplier = { supplierCode: 'NM01', leadTimeDays: 14, ltDriftCount: 2, ltDriftLastAt: null };
      em.findOne.mockResolvedValue(supplier);
      em.save.mockImplementation((_: unknown, data: unknown) => Promise.resolve(data));

      const result = await service.ltOverride('NM01', { ltDays: 10, reason: 'Urgent order' }, 'sc_mgr');

      expect(result).toMatchObject({ leadTimeDays: 10, ltDriftCount: 3 });
      expect((result as typeof supplier).ltDriftLastAt).toBeInstanceOf(Date);
    });

    it('throws NotFoundException when supplier not found', async () => {
      const { service, ds } = await makeService();
      (ds as any)._em.findOne.mockResolvedValue(null);

      await expect(service.ltOverride('NM_UNKNOWN', { ltDays: 7, reason: 'test' }, 'user')).rejects.toThrow(NotFoundException);
    });
  });

  // ── getUploadTemplate ──────────────────────────────────────────────────────

  describe('getUploadTemplate', () => {
    it('returns correct CSV headers for supplier', async () => {
      const { service } = await makeService();
      const csv = service.getUploadTemplate('supplier');
      expect(csv).toContain('supplier_code');
      expect(csv).toContain('supplier_name');
      expect(csv).toContain('lead_time_days');
    });

    it('throws BadRequestException for unknown entity type', async () => {
      const { service } = await makeService();
      expect(() => service.getUploadTemplate('unknown_entity')).toThrow(BadRequestException);
    });
  });

  // ── importCsv (dry-run) ────────────────────────────────────────────────────

  describe('importCsv', () => {
    it('dry-run: validates rows without persisting', async () => {
      const { service } = await makeService();
      const csv = 'supplier_code,supplier_name,lead_time_days\nNM01,NM Name,14\nNM02,NM Name 2,7';

      const result = await service.importCsv('supplier', csv, true, 'admin');

      expect(result.total).toBe(2);
      expect(result.valid).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(result.imported).toBe(0); // dry-run: no persist
    });

    it('reports validation errors for missing required fields', async () => {
      const { service } = await makeService();
      const csv = 'supplier_code,supplier_name\n,Missing Code';

      const result = await service.importCsv('supplier', csv, true, 'admin');

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain('supplier_code');
    });

    it('throws BadRequestException on empty CSV', async () => {
      const { service } = await makeService();
      await expect(service.importCsv('supplier', 'header_only', false, 'admin')).rejects.toThrow(BadRequestException);
    });
  });

  // ── getQualityMetrics ──────────────────────────────────────────────────────

  describe('getQualityMetrics', () => {
    it('returns zero counts when no data quality issues', async () => {
      const { service, ds } = await makeService();
      (ds.query as jest.Mock).mockResolvedValue([{ count: '0' }]);

      const result = await service.getQualityMetrics();

      expect(result.skuNoNmMapping).toBe(0);
      expect(result.channelNoLatLng).toBe(0);
      expect(result.supplierNoSkuMapping).toBe(0);
    });

    it('returns non-zero counts when quality issues exist', async () => {
      const { service, ds } = await makeService();
      (ds.query as jest.Mock)
        .mockResolvedValueOnce([{ count: '3' }])
        .mockResolvedValueOnce([{ count: '1' }])
        .mockResolvedValueOnce([{ count: '5' }]);

      const result = await service.getQualityMetrics();

      expect(result.skuNoNmMapping).toBe(3);
      expect(result.channelNoLatLng).toBe(1);
      expect(result.supplierNoSkuMapping).toBe(5);
    });
  });

  // ── createChannel ──────────────────────────────────────────────────────────

  describe('createChannel', () => {
    it('throws ConflictException when cn_code already exists', async () => {
      const { service, ds } = await makeService();
      (ds as any)._em.findOne.mockResolvedValue({ id: '1', cnCode: 'CN01' });

      await expect(
        service.createChannel({ cnCode: 'CN01', cnName: 'Test', lat: 10, lng: 106 } as any, 'user1'),
      ).rejects.toThrow(ConflictException);
    });

    it('creates channel and writes audit log', async () => {
      const { service, ds } = await makeService();
      const em = (ds as any)._em;
      em.findOne.mockResolvedValue(null);
      em.save.mockImplementation((_: unknown, data: unknown) => Promise.resolve({ ...(data as object), id: '10' }));

      const result = await service.createChannel(
        { cnCode: 'CN01', cnName: 'Channel 1', lat: 10.5, lng: 106.7 } as any,
        'user1',
      );

      expect(result).toMatchObject({ id: '10' });
      expect(em.save).toHaveBeenCalledTimes(2); // channel + audit
    });
  });

  // ── updateChannel ──────────────────────────────────────────────────────────

  describe('updateChannel', () => {
    it('throws NotFoundException when channel not found', async () => {
      const { service, ds } = await makeService();
      (ds as any)._em.findOne.mockResolvedValue(null);

      await expect(service.updateChannel('999', { cnName: 'New' }, 'user1')).rejects.toThrow(NotFoundException);
    });

    it('updates only provided fields', async () => {
      const { service, ds } = await makeService();
      const em = (ds as any)._em;
      const channel = { id: '1', cnCode: 'CN01', cnName: 'Old Name', region: null };
      em.findOne.mockResolvedValue(channel);
      em.save.mockImplementation((_: unknown, data: unknown) => Promise.resolve(data));

      const result = await service.updateChannel('1', { cnName: 'New Name' }, 'user1');

      expect((result as typeof channel).cnName).toBe('New Name');
    });
  });

  // ── deactivateChannel ──────────────────────────────────────────────────────

  describe('deactivateChannel', () => {
    it('throws BadRequestException when already inactive', async () => {
      const { service, ds } = await makeService();
      (ds as any)._em.findOne.mockResolvedValue({ id: '1', active: false });

      await expect(service.deactivateChannel('1', 'user1')).rejects.toThrow(BadRequestException);
    });

    it('sets active=false and writes audit', async () => {
      const { service, ds } = await makeService();
      const em = (ds as any)._em;
      em.findOne.mockResolvedValue({ id: '1', active: true });
      em.save.mockImplementation((_: unknown, data: unknown) => Promise.resolve(data));

      await service.deactivateChannel('1', 'user1');

      expect(em.save).toHaveBeenCalledWith(Channel, expect.objectContaining({ active: false }));
    });
  });

  // ── createHub ─────────────────────────────────────────────────────────────

  describe('createHub', () => {
    it('throws ConflictException when hub_code already exists', async () => {
      const { service, ds } = await makeService();
      (ds as any)._em.findOne.mockResolvedValue({ id: '1', hubCode: 'HUB01' });

      await expect(
        service.createHub({ hubCode: 'HUB01', hubName: 'Hub 1' } as any, 'user1'),
      ).rejects.toThrow(ConflictException);
    });

    it('creates hub with VIRTUAL type by default', async () => {
      const { service, ds } = await makeService();
      const em = (ds as any)._em;
      em.findOne.mockResolvedValue(null);
      em.save.mockImplementation((_: unknown, data: unknown) => Promise.resolve({ ...(data as object), id: '5' }));

      const result = await service.createHub({ hubCode: 'HUB01', hubName: 'Hub 1' } as any, 'user1');

      expect(em.create).toHaveBeenCalledWith(Hub, expect.objectContaining({ hubType: 'VIRTUAL' }));
      expect(result).toMatchObject({ id: '5' });
    });
  });

  // ── updateHub ─────────────────────────────────────────────────────────────

  describe('updateHub', () => {
    it('throws NotFoundException when hub not found', async () => {
      const { service, ds } = await makeService();
      (ds as any)._em.findOne.mockResolvedValue(null);

      await expect(service.updateHub('999', { hubName: 'X' }, 'user1')).rejects.toThrow(NotFoundException);
    });

    it('updates hub fields', async () => {
      const { service, ds } = await makeService();
      const em = (ds as any)._em;
      const hub = { id: '1', hubCode: 'HUB01', hubName: 'Old', hubType: 'VIRTUAL', lat: null, lng: null, capacity: null };
      em.findOne.mockResolvedValue(hub);
      em.save.mockImplementation((_: unknown, data: unknown) => Promise.resolve(data));

      const result = await service.updateHub('1', { hubName: 'New Hub' }, 'user1');

      expect((result as typeof hub).hubName).toBe('New Hub');
    });
  });

  // ── assignHubNm ───────────────────────────────────────────────────────────

  describe('assignHubNm', () => {
    it('throws NotFoundException when hub not found', async () => {
      const { service, ds } = await makeService();
      (ds as any)._em.findOne.mockResolvedValue(null);

      await expect(service.assignHubNm('999', { nmCode: 'NM01' }, 'user1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when supplier not found', async () => {
      const { service, ds } = await makeService();
      const em = (ds as any)._em;
      em.findOne.mockImplementation((entity: unknown) => {
        if (entity === Hub) return Promise.resolve({ id: '1' });
        if (entity === Supplier) return Promise.resolve(null);
        return Promise.resolve(null);
      });

      await expect(service.assignHubNm('1', { nmCode: 'NM99' }, 'user1')).rejects.toThrow(BadRequestException);
    });

    it('creates assignment with nm_code populated (BUG-M00-01 fix)', async () => {
      const { service, ds } = await makeService();
      const em = (ds as any)._em;
      em.findOne.mockImplementation((entity: unknown) => {
        if (entity === Hub) return Promise.resolve({ id: '1' });
        if (entity === Supplier) return Promise.resolve({ supplierCode: 'NM01', status: 'ACTIVE' });
        if (entity === HubNmAssignment) return Promise.resolve(null); // new assignment
        return Promise.resolve(null);
      });
      em.save.mockImplementation((_: unknown, data: unknown) => Promise.resolve({ ...(data as object), id: '20' }));

      const result = await service.assignHubNm('1', { nmCode: 'NM01' }, 'user1');

      expect(em.create).toHaveBeenCalledWith(
        HubNmAssignment,
        expect.objectContaining({ nmCode: 'NM01', nmId: '0', active: true }),
      );
      expect(result).toMatchObject({ id: '20' });
    });
  });

  // ── upsertSkuCnMapping ────────────────────────────────────────────────────

  describe('upsertSkuCnMapping', () => {
    it('creates new mapping when none exists', async () => {
      const { service, ds } = await makeService();
      const em = (ds as any)._em;
      em.findOne.mockImplementation((entity: unknown) => {
        if (entity === Sku) return Promise.resolve({ id: '1' });
        if (entity === Channel) return Promise.resolve({ id: '2' });
        if (entity === SkuCnMapping) return Promise.resolve(null);
        return Promise.resolve(null);
      });
      em.save.mockImplementation((_: unknown, data: unknown) => Promise.resolve({ ...(data as object), id: '30' }));

      const result = await service.upsertSkuCnMapping({ skuId: '1', cnId: '2' } as any, 'user1');

      expect(result).toMatchObject({ id: '30' });
      expect(em.create).toHaveBeenCalledWith(SkuCnMapping, expect.objectContaining({ skuId: '1', cnId: '2' }));
    });

    it('throws NotFoundException when SKU not found', async () => {
      const { service, ds } = await makeService();
      (ds as any)._em.findOne.mockResolvedValue(null);

      await expect(
        service.upsertSkuCnMapping({ skuId: '999', cnId: '1' } as any, 'user1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── getAuditLog ───────────────────────────────────────────────────────────

  describe('getAuditLog', () => {
    it('returns paginated audit log with meta', async () => {
      const { service } = await makeService();

      const result = await service.getAuditLog({ page: 1, pageSize: 20 });

      expect(result).toMatchObject({ data: [], meta: { page: 1, pageSize: 20, total: 0 } });
    });

    it('filters by entityType', async () => {
      const { service } = await makeService();
      // getManyAndCount is mocked to return empty — just assert no error thrown
      await expect(service.getAuditLog({ page: 1, pageSize: 10, entityType: 'SKU' })).resolves.toBeDefined();
    });
  });

  // ── createCustomer ────────────────────────────────────────────────────────

  describe('createCustomer', () => {
    it('creates customer with default B2B type', async () => {
      const { service, ds } = await makeService();
      const em = (ds as any)._em;
      em.findOne.mockResolvedValue(null); // no duplicate
      em.save.mockImplementation((_: unknown, data: unknown) => Promise.resolve({ ...(data as object), id: '50' }));

      const result = await service.createCustomer(
        { customerCode: 'CUS01', customerName: 'CTCP ABC' } as any,
        'user1',
      );

      expect(result).toMatchObject({ id: '50' });
      expect(em.create).toHaveBeenCalledWith(Customer, expect.objectContaining({ customerType: 'B2B', active: true }));
    });

    it('throws ConflictException when customer_code already exists', async () => {
      const { service, ds } = await makeService();
      (ds as any)._em.findOne.mockResolvedValue({ id: '1', customerCode: 'CUS01' });

      await expect(
        service.createCustomer({ customerCode: 'CUS01', customerName: 'Test' } as any, 'user1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── deactivateCustomer ────────────────────────────────────────────────────

  describe('deactivateCustomer', () => {
    it('throws NotFoundException when customer not found', async () => {
      const { service, ds } = await makeService();
      (ds as any)._em.findOne.mockResolvedValue(null);

      await expect(service.deactivateCustomer('999', 'user1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when customer already inactive', async () => {
      const { service, ds } = await makeService();
      (ds as any)._em.findOne.mockResolvedValue({ id: '1', active: false });

      await expect(service.deactivateCustomer('1', 'user1')).rejects.toThrow(BadRequestException);
    });

    it('deactivates customer + all channel links atomically', async () => {
      const { service, ds } = await makeService();
      const em = (ds as any)._em;
      em.findOne.mockResolvedValue({ id: '1', active: true });
      em.find.mockResolvedValue([
        { id: '10', customerId: '1', cnId: '5', active: true },
        { id: '11', customerId: '1', cnId: '6', active: true },
      ]);
      em.save.mockImplementation((_: unknown, data: unknown) => Promise.resolve(data));

      await service.deactivateCustomer('1', 'user1');

      // customer set inactive
      expect(em.save).toHaveBeenCalledWith(Customer, expect.objectContaining({ active: false }));
      // 2 links deactivated + audit = 4 saves total
      expect(em.save).toHaveBeenCalledTimes(4);
    });
  });

  // ── linkCustomerCn ────────────────────────────────────────────────────────

  describe('linkCustomerCn', () => {
    it('creates new link when none exists', async () => {
      const { service, ds } = await makeService();
      const em = (ds as any)._em;
      em.findOne.mockImplementation((entity: unknown) => {
        if (entity === Customer) return Promise.resolve({ id: '1' });
        if (entity === Channel) return Promise.resolve({ id: '5' });
        if (entity === CustomerCn) return Promise.resolve(null); // no existing link
        return Promise.resolve(null);
      });
      em.save.mockImplementation((_: unknown, data: unknown) => Promise.resolve({ ...(data as object), id: '99' }));

      const result = await service.linkCustomerCn('1', '5', false, 'user1');

      expect(result).toMatchObject({ id: '99' });
      expect(em.create).toHaveBeenCalledWith(CustomerCn, expect.objectContaining({ customerId: '1', cnId: '5' }));
    });

    it('throws BadRequestException when customer already has a different primary CN', async () => {
      const { service, ds } = await makeService();
      const em = (ds as any)._em;
      em.findOne.mockImplementation((entity: unknown) => {
        if (entity === Customer) return Promise.resolve({ id: '1' });
        if (entity === Channel) return Promise.resolve({ id: '6' });
        if (entity === CustomerCn && (em.findOne as jest.Mock).mock.calls.length === 3) {
          // 3rd call = existing primary lookup
          return Promise.resolve({ id: '10', cnId: '5', isPrimary: true, active: true }); // different CN
        }
        return Promise.resolve(null);
      });

      await expect(
        service.linkCustomerCn('1', '6', true, 'user1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when channel not found', async () => {
      const { service, ds } = await makeService();
      const em = (ds as any)._em;
      em.findOne.mockImplementation((entity: unknown) => {
        if (entity === Customer) return Promise.resolve({ id: '1' });
        if (entity === Channel) return Promise.resolve(null);
        return Promise.resolve(null);
      });

      await expect(service.linkCustomerCn('1', '999', false, 'user1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── unlinkCustomerCn ──────────────────────────────────────────────────────

  describe('unlinkCustomerCn', () => {
    it('throws NotFoundException when no active link found', async () => {
      const { service, ds } = await makeService();
      (ds as any)._em.findOne.mockResolvedValue(null);

      await expect(service.unlinkCustomerCn('1', '5', 'user1')).rejects.toThrow(NotFoundException);
    });

    it('sets link active=false', async () => {
      const { service, ds } = await makeService();
      const em = (ds as any)._em;
      const link = { id: '10', customerId: '1', cnId: '5', active: true };
      em.findOne.mockResolvedValue(link);
      em.save.mockImplementation((_: unknown, data: unknown) => Promise.resolve(data));

      await service.unlinkCustomerCn('1', '5', 'user1');

      expect(em.save).toHaveBeenCalledWith(CustomerCn, expect.objectContaining({ active: false }));
    });
  });

  // ── _parseCsvLine (M-02 fix) ──────────────────────────────────────────────

  describe('_parseCsvLine (CSV quoted-value parser)', () => {
    it('handles simple unquoted fields', async () => {
      const { service } = await makeService();
      const result = (service as any)._parseCsvLine('NM01,NM Name,14');
      expect(result).toEqual(['NM01', 'NM Name', '14']);
    });

    it('handles quoted fields with embedded comma (M-02 fix)', async () => {
      const { service } = await makeService();
      // Real-world: Vietnamese company name with comma
      const result = (service as any)._parseCsvLine('"CTCP Gạch, Ngói ABC",NM01,30');
      expect(result).toEqual(['CTCP Gạch, Ngói ABC', 'NM01', '30']);
    });

    it('handles escaped double-quotes inside quoted field', async () => {
      const { service } = await makeService();
      const result = (service as any)._parseCsvLine('"He said ""hello""",NM01');
      expect(result).toEqual(['He said "hello"', 'NM01']);
    });

    it('importCsv: dry-run passes with quoted company name containing comma', async () => {
      const { service } = await makeService();
      const csv = `supplier_code,supplier_name,lead_time_days\nNM01,"CTCP Gạch, Ngói ABC",14`;

      const result = await service.importCsv('supplier', csv, true, 'admin');

      expect(result.errors).toHaveLength(0);
      expect(result.valid).toBe(1);
    });
  });
});
