import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';

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

import { CreateSkuDto } from './dto/create-sku.dto';
import { UpdateSkuDto } from './dto/update-sku.dto';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CreateHubDto, UpdateHubDto } from './dto/create-hub.dto';
import { UpsertSkuCnMappingDto, PatchSkuCnMappingDto, QuerySkuCnMappingDto } from './dto/upsert-sku-cn-mapping.dto';
import { SkuQueryDto, ChannelQueryDto, SupplierQueryDto, HubQueryDto, CustomerQueryDto } from './dto/query.dto';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { ChangeNmDto } from './dto/change-nm.dto';
import { LtOverrideDto } from './dto/lt-override.dto';
import { AuditQueryDto } from './dto/audit-query.dto';
import { AssignHubNmDto } from './dto/assign-hub-nm.dto';
import { PaginatedResponse } from '../common/pagination.dto';
import { paginate, skipTake } from '../common/pagination.util';

interface AuditParams {
  entityType: string;
  entityId: string;
  action: string;
  changedFields: object | null;
  changedBy: string;
  source?: string;
}

@Injectable()
export class MasterDataService {
  constructor(
    @InjectRepository(Sku)
    private readonly skuRepo: Repository<Sku>,
    @InjectRepository(SkuVariant)
    private readonly skuVariantRepo: Repository<SkuVariant>,
    @InjectRepository(Channel)
    private readonly channelRepo: Repository<Channel>,
    @InjectRepository(Supplier)
    private readonly supplierRepo: Repository<Supplier>,
    @InjectRepository(Hub)
    private readonly hubRepo: Repository<Hub>,
    @InjectRepository(SkuNmMapping)
    private readonly skuNmMappingRepo: Repository<SkuNmMapping>,
    @InjectRepository(SkuCnMapping)
    private readonly skuCnMappingRepo: Repository<SkuCnMapping>,
    @InjectRepository(HubCnCluster)
    private readonly hubCnClusterRepo: Repository<HubCnCluster>,
    @InjectRepository(HubNmAssignment)
    private readonly hubNmAssignmentRepo: Repository<HubNmAssignment>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(CustomerCn)
    private readonly customerCnRepo: Repository<CustomerCn>,
    @InjectRepository(MasterDataAuditLog)
    private readonly auditRepo: Repository<MasterDataAuditLog>,
    private readonly dataSource: DataSource,
  ) {}

  // ─── Audit Log ───────────────────────────────────────────────────────────────

  private async _audit(em: EntityManager, params: AuditParams): Promise<void> {
    const log = em.create(MasterDataAuditLog, {
      entityType: params.entityType,
      entityId: params.entityId,
      action: params.action,
      changedFields: params.changedFields,
      changedBy: params.changedBy,
      source: params.source ?? 'UI',
    });
    await em.save(MasterDataAuditLog, log);
  }

  // ─── SKU ─────────────────────────────────────────────────────────────────────

  async createSku(dto: CreateSkuDto, userId: string): Promise<Sku> {
    return this.dataSource.transaction(async (em) => {
      // 1. Validate supplier (supplier_code) exists and is ACTIVE
      const supplier = await em.findOne(Supplier, {
        where: { supplierCode: dto.nmCode, status: 'ACTIVE' },
      });
      if (!supplier) {
        throw new BadRequestException(
          `Supplier with code '${dto.nmCode}' not found or inactive`,
        );
      }

      // 2. Check SKU code uniqueness
      const existing = await em.findOne(Sku, { where: { skuCode: dto.skuCode } });
      if (existing) {
        throw new ConflictException(`SKU code '${dto.skuCode}' already exists`);
      }

      // 3. INSERT sku
      const sku = em.create(Sku, {
        skuCode: dto.skuCode,
        skuName: dto.skuName,
        uom: dto.uom ?? 'm2',
        productGroup: dto.productGroup ?? null,
        active: true,
        createdBy: userId,
        updatedBy: userId,
      });
      const savedSku = await em.save(Sku, sku);

      // 4. INSERT sku_nm_mapping (single-source mandatory)
      // nm_id = 0 placeholder (supplier PK deviation — no BIGINT id)
      const mapping = em.create(SkuNmMapping, {
        skuId: savedSku.id,
        nmId: '0',
        nmCode: supplier.supplierCode,
        moq: dto.moq ?? 0,
        priority: 1,
        active: true,
      });
      await em.save(SkuNmMapping, mapping);

      // 5. INSERT variants if provided
      if (dto.variants && dto.variants.length > 0) {
        const variants = dto.variants.map((v) =>
          em.create(SkuVariant, {
            skuId: savedSku.id,
            variantCode: v.variantCode,
            variantSuffix: v.variantSuffix,
            variantName: v.variantName ?? null,
            attrs: v.attrs ?? null,
            active: true,
          }),
        );
        await em.save(SkuVariant, variants);
      }

      // 6. Audit log
      await this._audit(em, {
        entityType: 'SKU',
        entityId: savedSku.id,
        action: 'CREATE',
        changedFields: { skuCode: dto.skuCode, nmCode: dto.nmCode },
        changedBy: userId,
      });

      return savedSku;
    });
  }

  async listSkus(query: SkuQueryDto): Promise<PaginatedResponse<Sku & { nmCode: string | null }>> {
    const { page, pageSize, search, active, productGroup } = query;
    const { skip, take } = skipTake(page, pageSize);

    const qb = this.skuRepo
      .createQueryBuilder('sku')
      // Issue-8 fix: add active nm_code inline so list view shows NM column
      .addSelect(
        `(SELECT m.nm_code FROM sku_nm_mapping m WHERE m.sku_id = sku.id AND m.active = TRUE LIMIT 1)`,
        'sku_nm_code',
      );

    if (search) {
      qb.andWhere('(sku.sku_code ILIKE :s OR sku.sku_name ILIKE :s)', {
        s: `%${search}%`,
      });
    }
    if (active !== undefined) {
      qb.andWhere('sku.active = :active', { active });
    }
    if (productGroup) {
      qb.andWhere('sku.product_group = :productGroup', { productGroup });
    }

    qb.orderBy('sku.created_at', 'DESC').skip(skip).take(take);
    const [rawSkus, total] = await qb.getManyAndCount();

    // getRawAndEntities would be cleaner but getManyAndCount loses raw cols.
    // Re-fetch nmCodes for the page — cheap (1 IN query) and keeps pagination correct.
    const skuIds = rawSkus.map((s) => s.id);
    const nmRows: { sku_id: string; nm_code: string }[] =
      skuIds.length > 0
        ? await this.dataSource.query(
            `SELECT sku_id, nm_code FROM sku_nm_mapping WHERE sku_id = ANY($1) AND active = TRUE`,
            [skuIds],
          )
        : [];
    const nmBySkuId = new Map(nmRows.map((r) => [r.sku_id, r.nm_code]));

    const data = rawSkus.map((sku) =>
      Object.assign(sku, { nmCode: nmBySkuId.get(sku.id) ?? null }),
    );

    return paginate(data, total, page, pageSize);
  }

  async getSku(
    id: string,
  ): Promise<Sku & { nmCode: string | null; moq: number; variants: SkuVariant[] }> {
    const sku = await this.skuRepo.findOne({ where: { id } });
    if (!sku) throw new NotFoundException(`SKU ${id} not found`);

    const [activeMapping, variants] = await Promise.all([
      this.skuNmMappingRepo.findOne({ where: { skuId: id, active: true } }),
      this.skuVariantRepo.find({ where: { skuId: id, active: true } }),
    ]);

    return Object.assign(sku, {
      nmCode: activeMapping?.nmCode ?? null,
      moq: activeMapping?.moq ?? 0,
      variants,
    });
  }

  async updateSku(id: string, dto: UpdateSkuDto, userId: string): Promise<Sku> {
    return this.dataSource.transaction(async (em) => {
      const sku = await em.findOne(Sku, { where: { id } });
      if (!sku) throw new NotFoundException(`SKU ${id} not found`);

      const changedFields: Record<string, [unknown, unknown]> = {};

      if (dto.skuName !== undefined && dto.skuName !== sku.skuName) {
        changedFields.skuName = [sku.skuName, dto.skuName];
        sku.skuName = dto.skuName;
      }
      if (dto.uom !== undefined && dto.uom !== sku.uom) {
        changedFields.uom = [sku.uom, dto.uom];
        sku.uom = dto.uom;
      }
      if (dto.productGroup !== undefined && dto.productGroup !== sku.productGroup) {
        changedFields.productGroup = [sku.productGroup, dto.productGroup];
        sku.productGroup = dto.productGroup ?? null;
      }
      sku.updatedBy = userId;
      const saved = await em.save(Sku, sku);

      // Update NM mapping if nmCode changed
      if (dto.nmCode !== undefined) {
        const supplier = await em.findOne(Supplier, {
          where: { supplierCode: dto.nmCode, status: 'ACTIVE' },
        });
        if (!supplier) {
          throw new BadRequestException(
            `Supplier with code '${dto.nmCode}' not found or inactive`,
          );
        }
        const oldMapping = await em.findOne(SkuNmMapping, {
          where: { skuId: id, active: true },
        });

        if (oldMapping && oldMapping.nmCode !== supplier.supplierCode) {
          // BUG-3 fix: deactivate old mapping to preserve history (audit trail),
          // then insert a new mapping — never overwrite nm_code in-place.
          changedFields.nmCode = [oldMapping.nmCode, dto.nmCode];
          oldMapping.active = false;
          await em.save(SkuNmMapping, oldMapping);

          const newMapping = em.create(SkuNmMapping, {
            skuId: id,
            nmId: '0', // placeholder — supplier has no BIGINT id
            nmCode: supplier.supplierCode,
            moq: dto.moq ?? oldMapping.moq,
            priority: 1,
            active: true,
          });
          await em.save(SkuNmMapping, newMapping);
        } else if (oldMapping && dto.moq !== undefined) {
          // Same supplier, just update MOQ
          oldMapping.moq = dto.moq;
          await em.save(SkuNmMapping, oldMapping);
        }
      } else if (dto.moq !== undefined) {
        const existingMapping = await em.findOne(SkuNmMapping, {
          where: { skuId: id, active: true },
        });
        if (existingMapping) {
          existingMapping.moq = dto.moq;
          await em.save(SkuNmMapping, existingMapping);
        }
      }

      await this._audit(em, {
        entityType: 'SKU',
        entityId: id,
        action: 'UPDATE',
        changedFields,
        changedBy: userId,
      });

      return saved;
    });
  }

  async deactivateSku(id: string, userId: string): Promise<void> {
    return this.dataSource.transaction(async (em) => {
      const sku = await em.findOne(Sku, { where: { id } });
      if (!sku) throw new NotFoundException(`SKU ${id} not found`);
      if (!sku.active) throw new BadRequestException(`SKU ${id} is already inactive`);

      // Soft delete: set active = false
      sku.active = false;
      sku.updatedBy = userId;
      await em.save(Sku, sku);

      // BUG-4 fix: use find+save (not em.update) to stay within transaction lifecycle
      // em.update() bypasses TypeORM hooks; explicit save is safer and consistent.
      const activeMappings = await em.find(SkuNmMapping, { where: { skuId: id, active: true } });
      for (const m of activeMappings) {
        m.active = false;
        await em.save(SkuNmMapping, m);
      }

      await this._audit(em, {
        entityType: 'SKU',
        entityId: id,
        action: 'DELETE',
        changedFields: { active: [true, false] },
        changedBy: userId,
      });
    });
  }

  // ─── Channel (CN) ────────────────────────────────────────────────────────────

  async createChannel(dto: CreateChannelDto, userId: string): Promise<Channel> {
    return this.dataSource.transaction(async (em) => {
      const existing = await em.findOne(Channel, { where: { cnCode: dto.cnCode } });
      if (existing) {
        throw new ConflictException(`Channel code '${dto.cnCode}' already exists`);
      }

      const channel = em.create(Channel, {
        cnCode: dto.cnCode,
        cnName: dto.cnName,
        region: dto.region ?? null,
        address: dto.address ?? null,
        lat: dto.lat,
        lng: dto.lng,
        connectivity: dto.connectivity ?? 'GOOD',
        active: true,
      });
      const saved = await em.save(Channel, channel);

      await this._audit(em, {
        entityType: 'CHANNEL',
        entityId: saved.id,
        action: 'CREATE',
        changedFields: { cnCode: dto.cnCode },
        changedBy: userId,
      });

      return saved;
    });
  }

  async listChannels(query: ChannelQueryDto): Promise<PaginatedResponse<Channel>> {
    const { page, pageSize, search, active, region } = query;
    const { skip, take } = skipTake(page, pageSize);

    const qb = this.channelRepo.createQueryBuilder('ch');

    if (search) {
      qb.andWhere('(ch.cn_code ILIKE :s OR ch.cn_name ILIKE :s)', { s: `%${search}%` });
    }
    if (active !== undefined) {
      qb.andWhere('ch.active = :active', { active });
    }
    if (region) {
      qb.andWhere('ch.region = :region', { region });
    }

    qb.orderBy('ch.created_at', 'DESC').skip(skip).take(take);
    const [data, total] = await qb.getManyAndCount();

    return paginate(data, total, page, pageSize);
  }

  async getChannel(id: string): Promise<Channel> {
    const channel = await this.channelRepo.findOne({ where: { id } });
    if (!channel) throw new NotFoundException(`Channel ${id} not found`);
    return channel;
  }

  async updateChannel(id: string, dto: UpdateChannelDto, userId: string): Promise<Channel> {
    return this.dataSource.transaction(async (em) => {
      const channel = await em.findOne(Channel, { where: { id } });
      if (!channel) throw new NotFoundException(`Channel ${id} not found`);

      const changedFields: Record<string, [unknown, unknown]> = {};
      if (dto.cnName !== undefined && dto.cnName !== channel.cnName) {
        changedFields.cnName = [channel.cnName, dto.cnName];
        channel.cnName = dto.cnName;
      }
      if (dto.region !== undefined) { channel.region = dto.region; }
      if (dto.address !== undefined) { channel.address = dto.address; }
      if (dto.lat !== undefined) { channel.lat = dto.lat; }
      if (dto.lng !== undefined) { channel.lng = dto.lng; }
      if (dto.connectivity !== undefined) { channel.connectivity = dto.connectivity; }

      const saved = await em.save(Channel, channel);

      await this._audit(em, {
        entityType: 'CHANNEL',
        entityId: id,
        action: 'UPDATE',
        changedFields,
        changedBy: userId,
      });

      return saved;
    });
  }

  async deactivateChannel(id: string, userId: string): Promise<void> {
    return this.dataSource.transaction(async (em) => {
      const channel = await em.findOne(Channel, { where: { id } });
      if (!channel) throw new NotFoundException(`Channel ${id} not found`);
      if (!channel.active) throw new BadRequestException(`Channel ${id} is already inactive`);

      channel.active = false;
      await em.save(Channel, channel);

      await this._audit(em, {
        entityType: 'CHANNEL',
        entityId: id,
        action: 'DELETE',
        changedFields: { active: [true, false] },
        changedBy: userId,
      });
    });
  }

  // ─── Supplier (NM) ───────────────────────────────────────────────────────────

  async listSuppliers(
    query: SupplierQueryDto,
  ): Promise<{ data: Supplier[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }> {
    const { page, pageSize, search, active } = query;
    const { skip, take } = skipTake(page, pageSize);

    const qb = this.supplierRepo.createQueryBuilder('s');

    if (search) {
      qb.andWhere(
        '(s.supplier_code ILIKE :sr OR s.supplier_name ILIKE :sr)',
        { sr: `%${search}%` },
      );
    }
    // active=true → status='ACTIVE', active=false → status='INACTIVE'
    if (active !== undefined) {
      qb.andWhere('s.status = :status', { status: active ? 'ACTIVE' : 'INACTIVE' });
    }

    qb.orderBy('s.supplier_code', 'ASC').skip(skip).take(take);
    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async getSupplier(supplierCode: string): Promise<Supplier> {
    const supplier = await this.supplierRepo.findOne({ where: { supplierCode } });
    if (!supplier) throw new NotFoundException(`Supplier '${supplierCode}' not found`);
    return supplier;
  }

  async updateSupplier(supplierCode: string, dto: UpdateSupplierDto, userId: string): Promise<Supplier> {
    return this.dataSource.transaction(async (em) => {
      const supplier = await em.findOne(Supplier, { where: { supplierCode } });
      if (!supplier) throw new NotFoundException(`Supplier '${supplierCode}' not found`);

      const changedFields: Record<string, [unknown, unknown]> = {};

      // Only update fields that exist in actual supplier table
      if (dto.supplierName !== undefined) {
        changedFields.supplierName = [supplier.supplierName, dto.supplierName];
        supplier.supplierName = dto.supplierName;
      }
      if (dto.leadTimeDays !== undefined) {
        changedFields.leadTimeDays = [supplier.leadTimeDays, dto.leadTimeDays];
        supplier.leadTimeDays = dto.leadTimeDays ?? null;
      }
      if (dto.region !== undefined) { supplier.region = dto.region ?? null; }
      if (dto.factoryCode !== undefined) { supplier.factoryCode = dto.factoryCode ?? null; }
      if (dto.status !== undefined) {
        changedFields.status = [supplier.status, dto.status];
        supplier.status = dto.status;
      }

      const saved = await em.save(Supplier, supplier);

      await this._audit(em, {
        entityType: 'SUPPLIER',
        entityId: supplier.supplierCode,
        action: 'UPDATE',
        changedFields,
        changedBy: userId,
      });

      return saved;
    });
  }

  // ─── Hub ─────────────────────────────────────────────────────────────────────

  async createHub(dto: CreateHubDto, userId: string): Promise<Hub> {
    return this.dataSource.transaction(async (em) => {
      const existing = await em.findOne(Hub, { where: { hubCode: dto.hubCode } });
      if (existing) {
        throw new ConflictException(`Hub code '${dto.hubCode}' already exists`);
      }

      const hub = em.create(Hub, {
        hubCode: dto.hubCode,
        hubName: dto.hubName,
        hubType: dto.hubType ?? 'VIRTUAL',
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
        capacity: dto.capacity ?? null,
        active: true,
      });
      const saved = await em.save(Hub, hub);

      await this._audit(em, {
        entityType: 'HUB',
        entityId: saved.id,
        action: 'CREATE',
        changedFields: { hubCode: dto.hubCode },
        changedBy: userId,
      });

      return saved;
    });
  }

  async listHubs(query: HubQueryDto): Promise<PaginatedResponse<Hub>> {
    const { page, pageSize, search, active, hubType } = query;
    const { skip, take } = skipTake(page, pageSize);

    const qb = this.hubRepo.createQueryBuilder('h');

    if (search) {
      qb.andWhere('(h.hub_code ILIKE :s OR h.hub_name ILIKE :s)', { s: `%${search}%` });
    }
    if (active !== undefined) {
      qb.andWhere('h.active = :active', { active });
    }
    if (hubType) {
      qb.andWhere('h.hub_type = :hubType', { hubType });
    }

    qb.orderBy('h.hub_code', 'ASC').skip(skip).take(take);
    const [data, total] = await qb.getManyAndCount();

    return paginate(data, total, page, pageSize);
  }

  async updateHub(id: string, dto: UpdateHubDto, userId: string): Promise<Hub> {
    return this.dataSource.transaction(async (em) => {
      const hub = await em.findOne(Hub, { where: { id } });
      if (!hub) throw new NotFoundException(`Hub ${id} not found`);

      const changedFields: Record<string, [unknown, unknown]> = {};

      if (dto.hubName !== undefined) { changedFields.hubName = [hub.hubName, dto.hubName]; hub.hubName = dto.hubName; }
      if (dto.hubType !== undefined) { hub.hubType = dto.hubType; }
      if (dto.lat !== undefined) { hub.lat = dto.lat ?? null; }
      if (dto.lng !== undefined) { hub.lng = dto.lng ?? null; }
      if (dto.capacity !== undefined) { hub.capacity = dto.capacity ?? null; }

      const saved = await em.save(Hub, hub);

      await this._audit(em, {
        entityType: 'HUB',
        entityId: id,
        action: 'UPDATE',
        changedFields,
        changedBy: userId,
      });

      return saved;
    });
  }

  // ─── BUG-M00-01: POST /hubs/:id/assign-nm ────────────────────────────────────
  // Assigns a supplier to a hub. Populates nm_code (real FK) and nm_id=0 (placeholder).
  // M13 (Hub Booking) and M16 (Hub Supply) depend on nm_code for supplier lookup.

  async assignHubNm(hubId: string, dto: AssignHubNmDto, userId: string): Promise<HubNmAssignment> {
    return this.dataSource.transaction(async (em) => {
      const hub = await em.findOne(Hub, { where: { id: hubId } });
      if (!hub) throw new NotFoundException(`Hub ${hubId} not found`);

      const supplier = await em.findOne(Supplier, {
        where: { supplierCode: dto.nmCode, status: 'ACTIVE' },
      });
      if (!supplier) {
        throw new BadRequestException(`Supplier '${dto.nmCode}' not found or inactive`);
      }

      // Check if assignment already exists — upsert pattern
      let assignment = await em.findOne(HubNmAssignment, {
        where: { hubId, nmCode: dto.nmCode },
      });

      const isNew = !assignment;
      if (!assignment) {
        assignment = em.create(HubNmAssignment, {
          hubId,
          nmId: '0',   // placeholder — supplier has no BIGINT id (Sprint 2 migration)
          nmCode: supplier.supplierCode,
          active: true,
        });
      } else {
        assignment.active = true; // reactivate if previously deactivated
      }

      const saved = await em.save(HubNmAssignment, assignment);

      await this._audit(em, {
        entityType: 'HUB_NM_ASSIGNMENT',
        entityId: hubId,
        action: isNew ? 'CREATE' : 'UPDATE',
        changedFields: { nmCode: supplier.supplierCode },
        changedBy: userId,
      });

      return saved;
    });
  }

  // ─── SKU-CN Mapping ──────────────────────────────────────────────────────────

  async upsertSkuCnMapping(dto: UpsertSkuCnMappingDto, userId: string): Promise<SkuCnMapping> {
    return this.dataSource.transaction(async (em) => {
      // Validate SKU and Channel exist
      const sku = await em.findOne(Sku, { where: { id: dto.skuId } });
      if (!sku) throw new NotFoundException(`SKU ${dto.skuId} not found`);

      const channel = await em.findOne(Channel, { where: { id: dto.cnId } });
      if (!channel) throw new NotFoundException(`Channel ${dto.cnId} not found`);

      let mapping = await em.findOne(SkuCnMapping, {
        where: { skuId: dto.skuId, cnId: dto.cnId },
      });

      const isNew = !mapping;
      if (!mapping) {
        mapping = em.create(SkuCnMapping, {
          skuId: dto.skuId,
          cnId: dto.cnId,
          ssOverride: null,
          zOverride: null,
          isCritical: false,
          active: true,
        });
      }

      if (dto.ssOverride !== undefined) mapping.ssOverride = dto.ssOverride ?? null;
      if (dto.zOverride !== undefined) mapping.zOverride = dto.zOverride ?? null;
      if (dto.isCritical !== undefined) mapping.isCritical = dto.isCritical;
      mapping.active = true;

      const saved = await em.save(SkuCnMapping, mapping);

      await this._audit(em, {
        entityType: 'SKU_CN_MAPPING',
        entityId: saved.id,
        action: isNew ? 'CREATE' : 'UPDATE',
        changedFields: { skuId: dto.skuId, cnId: dto.cnId },
        changedBy: userId,
      });

      return saved;
    });
  }

  async listSkuCnMappings(
    query: QuerySkuCnMappingDto,
  ): Promise<{ data: SkuCnMapping[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const { skip, take } = skipTake(page, pageSize);

    const qb = this.skuCnMappingRepo.createQueryBuilder('m');

    if (query.skuId) qb.andWhere('m.sku_id = :skuId', { skuId: query.skuId });
    if (query.cnId) qb.andWhere('m.cn_id = :cnId', { cnId: query.cnId });

    qb.orderBy('m.id', 'ASC').skip(skip).take(take);
    const [data, total] = await qb.getManyAndCount();

    return { data, total, page, pageSize };
  }

  async patchSkuCnMapping(
    id: string,
    dto: PatchSkuCnMappingDto,
    userId: string,
  ): Promise<SkuCnMapping> {
    return this.dataSource.transaction(async (em) => {
      const mapping = await em.findOne(SkuCnMapping, { where: { id } });
      if (!mapping) throw new NotFoundException(`SkuCnMapping ${id} not found`);

      const changedFields: Record<string, [unknown, unknown]> = {};
      if (dto.ssOverride !== undefined) {
        changedFields.ssOverride = [mapping.ssOverride, dto.ssOverride];
        mapping.ssOverride = dto.ssOverride ?? null;
      }
      if (dto.zOverride !== undefined) {
        changedFields.zOverride = [mapping.zOverride, dto.zOverride];
        mapping.zOverride = dto.zOverride ?? null;
      }
      if (dto.isCritical !== undefined) {
        changedFields.isCritical = [mapping.isCritical, dto.isCritical];
        mapping.isCritical = dto.isCritical;
      }

      const saved = await em.save(SkuCnMapping, mapping);

      await this._audit(em, {
        entityType: 'SKU_CN_MAPPING',
        entityId: id,
        action: 'UPDATE',
        changedFields,
        changedBy: dto.updatedBy ?? userId,
      });

      return saved;
    });
  }

  // ─── Data Quality Metrics ────────────────────────────────────────────────────

  async getQualityMetrics(): Promise<{
    skuNoNmMapping: number;
    channelNoLatLng: number;
    supplierNoSkuMapping: number;
    skuNoRecentSupply: number;
  }> {
    const [skuNoNm, channelNoLatLng, supplierNoSku] = await Promise.all([
      // SKUs with no active NM mapping (C3 fix: orphan mapping detection)
      this.dataSource.query<{ count: string }[]>(
        `SELECT COUNT(*) AS count
         FROM sku s
         WHERE s.active = TRUE
           AND NOT EXISTS (
             SELECT 1 FROM sku_nm_mapping m
             WHERE m.sku_id = s.id AND m.active = TRUE
           )`,
      ),
      // Channels with no lat/lng — always 0 because mandatory, but check anyway
      this.dataSource.query<{ count: string }[]>(
        `SELECT COUNT(*) AS count
         FROM channel
         WHERE active = TRUE AND (lat IS NULL OR lng IS NULL)`,
      ),
      // Suppliers with no active SKU mapping (join via nm_code — supplier PK deviation)
      this.dataSource.query<{ count: string }[]>(
        `SELECT COUNT(*) AS count
         FROM supplier sup
         WHERE sup.status = 'ACTIVE'
           AND NOT EXISTS (
             SELECT 1 FROM sku_nm_mapping m
             WHERE m.nm_code = sup.supplier_code AND m.active = TRUE
           )`,
      ),
    ]);

    return {
      skuNoNmMapping: parseInt(skuNoNm[0].count, 10),
      channelNoLatLng: parseInt(channelNoLatLng[0].count, 10),
      supplierNoSkuMapping: parseInt(supplierNoSku[0].count, 10),
      skuNoRecentSupply: 0, // Requires supply snapshot integration — stubbed for Phase 0
    };
  }

  // ─── PATCH /skus/:id/change-nm ───────────────────────────────────────────────
  // Spec v1.1 M2 fix: dedicated endpoint so reason is mandatory and clearly audited.

  async changeSkuNm(id: string, dto: ChangeNmDto, userId: string): Promise<{ skuId: string; nmCode: string }> {
    return this.dataSource.transaction(async (em) => {
      const sku = await em.findOne(Sku, { where: { id } });
      if (!sku) throw new NotFoundException(`SKU ${id} not found`);
      if (!sku.active) throw new BadRequestException(`SKU ${id} is inactive — cannot change NM`);

      const supplier = await em.findOne(Supplier, {
        where: { supplierCode: dto.nmCode, status: 'ACTIVE' },
      });
      if (!supplier) {
        throw new BadRequestException(`Supplier '${dto.nmCode}' not found or inactive`);
      }

      const oldMapping = await em.findOne(SkuNmMapping, { where: { skuId: id, active: true } });
      if (oldMapping?.nmCode === supplier.supplierCode) {
        throw new BadRequestException(`SKU ${id} is already mapped to supplier '${dto.nmCode}'`);
      }

      // Deactivate old mapping (preserve history)
      if (oldMapping) {
        oldMapping.active = false;
        await em.save(SkuNmMapping, oldMapping);
      }

      // Insert new mapping
      const newMapping = em.create(SkuNmMapping, {
        skuId: id,
        nmId: '0',
        nmCode: supplier.supplierCode,
        moq: dto.moq ?? oldMapping?.moq ?? 0,
        priority: 1,
        active: true,
      });
      await em.save(SkuNmMapping, newMapping);

      await this._audit(em, {
        entityType: 'SKU',
        entityId: id,
        action: 'UPDATE',
        changedFields: {
          nmCode: [oldMapping?.nmCode ?? null, supplier.supplierCode],
          reason: dto.reason,
        },
        changedBy: userId,
        source: 'UI',
      });

      return { skuId: id, nmCode: supplier.supplierCode };
    });
  }

  // ─── POST /suppliers/:code/lt-override ───────────────────────────────────────
  // Spec M2 fix: SC Manager escape hatch to force-override lead_time_days.
  // Increments lt_drift_count + sets lt_drift_last_at + writes audit log.

  async ltOverride(supplierCode: string, dto: LtOverrideDto, userId: string): Promise<Supplier> {
    return this.dataSource.transaction(async (em) => {
      const supplier = await em.findOne(Supplier, { where: { supplierCode } });
      if (!supplier) throw new NotFoundException(`Supplier '${supplierCode}' not found`);

      const oldLt = supplier.leadTimeDays;
      supplier.leadTimeDays = dto.ltDays;
      supplier.ltDriftCount = (supplier.ltDriftCount ?? 0) + 1;
      supplier.ltDriftLastAt = new Date();

      const saved = await em.save(Supplier, supplier);

      await this._audit(em, {
        entityType: 'SUPPLIER',
        entityId: supplierCode,
        action: 'UPDATE',
        changedFields: {
          leadTimeDays: [oldLt, dto.ltDays],
          ltDriftCount: supplier.ltDriftCount,
          reason: dto.reason,
          overrideBy: userId,
        },
        changedBy: userId,
        source: 'UI',
      });

      return saved;
    });
  }

  // ─── GET /suppliers/upload-template ──────────────────────────────────────────
  // Returns CSV template headers for M21 NM bulk import.
  // M21 will DEPEND on this endpoint — must be stable before Sprint 3 kick-off.

  getUploadTemplate(entityType: string): string {
    const templates: Record<string, string[]> = {
      supplier: [
        'supplier_code', 'supplier_name', 'lead_time_days', 'region', 'factory_code', 'status',
      ],
      sku: [
        'sku_code', 'sku_name', 'uom', 'product_group', 'nm_code', 'moq',
      ],
      channel: [
        'cn_code', 'cn_name', 'region', 'address', 'lat', 'lng', 'connectivity',
      ],
      hub: [
        'hub_code', 'hub_name', 'hub_type', 'lat', 'lng', 'capacity',
      ],
      customer: [
        'customer_code', 'customer_name', 'contact_email', 'contact_phone', 'customer_type',
      ],
    };

    const headers = templates[entityType];
    if (!headers) throw new BadRequestException(`Unknown entity type: ${entityType}`);
    return headers.join(',') + '\n';
  }

  // ─── POST /import/:entityType ─────────────────────────────────────────────────
  // Bulk CSV import with dry-run support.
  // Phase 1: validates rows and reports errors. Actual persist only when dryRun=false.

  /**
   * Parse a single CSV line correctly handling:
   * - Quoted fields: "CTCP Gạch, Ngói ABC" (commas inside quotes)
   * - Escaped quotes: "He said ""hello"""
   * - Unquoted fields: plain,values
   * M-02 fix: replaces the naive split(',') that breaks on company names with commas.
   */
  private _parseCsvLine(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // Escaped quote inside quoted field
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  }

  async importCsv(
    entityType: string,
    csvText: string,
    dryRun: boolean,
    userId: string,
  ): Promise<{ total: number; valid: number; errors: { row: number; message: string }[]; imported: number }> {
    // M-02 note: controller receives raw text body.
    // Caller must send Content-Type: text/plain (or configure raw body middleware).
    // NestJS default JSON parser is bypassed at route level via @Body() with text/plain accept.
    const lines = csvText.trim().split('\n').filter((l) => l.trim());
    if (lines.length < 2) {
      throw new BadRequestException('CSV must have a header row and at least one data row');
    }

    const headers = this._parseCsvLine(lines[0]);
    const dataLines = lines.slice(1);
    const errors: { row: number; message: string }[] = [];
    const validRows: Record<string, string>[] = [];

    for (let i = 0; i < dataLines.length; i++) {
      const rowNum = i + 2; // 1-based, accounting for header
      const values = this._parseCsvLine(dataLines[i]);
      if (values.length !== headers.length) {
        errors.push({ row: rowNum, message: `Column count mismatch (expected ${headers.length}, got ${values.length})` });
        continue;
      }
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { row[h] = values[idx]; });

      // Entity-specific validation
      const rowErrors = this._validateImportRow(entityType, row);
      if (rowErrors.length > 0) {
        rowErrors.forEach((msg) => errors.push({ row: rowNum, message: msg }));
      } else {
        validRows.push(row);
      }
    }

    let imported = 0;
    if (!dryRun && errors.length === 0) {
      imported = await this._persistImportRows(entityType, validRows, userId);
    } else if (!dryRun && errors.length > 0) {
      throw new BadRequestException(`Import aborted: ${errors.length} validation error(s). Fix and retry, or use dryRun=true to preview.`);
    }

    return { total: dataLines.length, valid: validRows.length, errors, imported };
  }

  private _validateImportRow(entityType: string, row: Record<string, string>): string[] {
    const errs: string[] = [];
    if (entityType === 'supplier') {
      if (!row['supplier_code']) errs.push('supplier_code is required');
      if (!row['supplier_name']) errs.push('supplier_name is required');
    } else if (entityType === 'sku') {
      if (!row['sku_code']) errs.push('sku_code is required');
      if (!row['sku_name']) errs.push('sku_name is required');
      if (!row['nm_code']) errs.push('nm_code is required');
    } else if (entityType === 'channel') {
      if (!row['cn_code']) errs.push('cn_code is required');
      if (!row['cn_name']) errs.push('cn_name is required');
      if (!row['lat'] || isNaN(Number(row['lat']))) errs.push('lat must be a number');
      if (!row['lng'] || isNaN(Number(row['lng']))) errs.push('lng must be a number');
    } else if (entityType === 'hub') {
      if (!row['hub_code']) errs.push('hub_code is required');
      if (!row['hub_name']) errs.push('hub_name is required');
    } else if (entityType === 'customer') {
      if (!row['customer_code']) errs.push('customer_code is required');
      if (!row['customer_name']) errs.push('customer_name is required');
    }
    return errs;
  }

  private async _persistImportRows(
    entityType: string,
    rows: Record<string, string>[],
    userId: string,
  ): Promise<number> {
    return this.dataSource.transaction(async (em) => {
      let count = 0;
      for (const row of rows) {
        if (entityType === 'supplier') {
          await em.query(
            `INSERT INTO supplier (supplier_code, supplier_name, lead_time_days, region, factory_code, status)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (supplier_code) DO UPDATE
               SET supplier_name = EXCLUDED.supplier_name,
                   lead_time_days = EXCLUDED.lead_time_days,
                   region = EXCLUDED.region,
                   factory_code = EXCLUDED.factory_code`,
            [
              row['supplier_code'],
              row['supplier_name'],
              row['lead_time_days'] ? parseInt(row['lead_time_days'], 10) : null,
              row['region'] || null,
              row['factory_code'] || null,
              row['status'] || 'ACTIVE',
            ],
          );
        } else if (entityType === 'sku') {
          const result = await em.query<{ id: string }[]>(
            `INSERT INTO sku (sku_code, sku_name, uom, product_group, active, created_by, updated_by)
             VALUES ($1, $2, $3, $4, TRUE, $5, $5)
             ON CONFLICT (sku_code) DO UPDATE SET sku_name = EXCLUDED.sku_name
             RETURNING id`,
            [row['sku_code'], row['sku_name'], row['uom'] || 'm2', row['product_group'] || null, userId],
          );
          const skuId = result[0]?.id;
          if (skuId && row['nm_code']) {
            // Deactivate any existing active mapping
            await em.query(`UPDATE sku_nm_mapping SET active = FALSE WHERE sku_id = $1 AND active = TRUE`, [skuId]);
            await em.query(
              `INSERT INTO sku_nm_mapping (sku_id, nm_id, nm_code, moq, priority, active)
               VALUES ($1, 0, $2, $3, 1, TRUE)`,
              [skuId, row['nm_code'], row['moq'] ? parseFloat(row['moq']) : 0],
            );
          }
        } else if (entityType === 'channel') {
          await em.query(
            `INSERT INTO channel (cn_code, cn_name, region, address, lat, lng, connectivity, active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
             ON CONFLICT (cn_code) DO UPDATE
               SET cn_name = EXCLUDED.cn_name, region = EXCLUDED.region`,
            [
              row['cn_code'], row['cn_name'], row['region'] || null, row['address'] || null,
              parseFloat(row['lat']), parseFloat(row['lng']), row['connectivity'] || 'GOOD',
            ],
          );
        } else if (entityType === 'hub') {
          await em.query(
            `INSERT INTO hub (hub_code, hub_name, hub_type, lat, lng, capacity, active)
             VALUES ($1, $2, $3, $4, $5, $6, TRUE)
             ON CONFLICT (hub_code) DO UPDATE SET hub_name = EXCLUDED.hub_name`,
            [
              row['hub_code'], row['hub_name'], row['hub_type'] || 'VIRTUAL',
              row['lat'] ? parseFloat(row['lat']) : null,
              row['lng'] ? parseFloat(row['lng']) : null,
              row['capacity'] ? parseFloat(row['capacity']) : null,
            ],
          );
        }
        await this._audit(em, {
          entityType: entityType.toUpperCase(),
          entityId: row[`${entityType}_code`] ?? row['sku_code'] ?? row['cn_code'] ?? row['hub_code'] ?? '?',
          action: 'IMPORT',
          changedFields: row,
          changedBy: userId,
          source: 'IMPORT',
        });
        count++;
      }
      return count;
    });
  }

  // ─── TD-03: Customer CRUD ─────────────────────────────────────────────────────

  async createCustomer(dto: CreateCustomerDto, userId: string): Promise<Customer> {
    return this.dataSource.transaction(async (em) => {
      const existing = await em.findOne(Customer, { where: { customerCode: dto.customerCode } });
      if (existing) {
        throw new ConflictException(`Customer code '${dto.customerCode}' already exists`);
      }

      const customer = em.create(Customer, {
        customerCode: dto.customerCode,
        customerName: dto.customerName,
        contactEmail: dto.contactEmail ?? null,
        contactPhone: dto.contactPhone ?? null,
        customerType: dto.customerType ?? 'B2B',
        active: true,
      });
      const saved = await em.save(Customer, customer);

      await this._audit(em, {
        entityType: 'CUSTOMER',
        entityId: saved.id,
        action: 'CREATE',
        changedFields: { customerCode: dto.customerCode, customerType: saved.customerType },
        changedBy: userId,
      });

      return saved;
    });
  }

  async listCustomers(query: CustomerQueryDto): Promise<PaginatedResponse<Customer>> {
    const { page, pageSize, search, active, customerType } = query;
    const { skip, take } = skipTake(page, pageSize);

    const qb = this.customerRepo.createQueryBuilder('c');

    if (search) {
      qb.andWhere('(c.customer_code ILIKE :s OR c.customer_name ILIKE :s)', { s: `%${search}%` });
    }
    if (active !== undefined) {
      qb.andWhere('c.active = :active', { active });
    }
    if (customerType) {
      qb.andWhere('c.customer_type = :customerType', { customerType });
    }

    qb.orderBy('c.created_at', 'DESC').skip(skip).take(take);
    const [data, total] = await qb.getManyAndCount();

    return paginate(data, total, page, pageSize);
  }

  async getCustomer(id: string): Promise<Customer & { channels: CustomerCn[] }> {
    const customer = await this.customerRepo.findOne({ where: { id } });
    if (!customer) throw new NotFoundException(`Customer ${id} not found`);

    const channels = await this.customerCnRepo.find({ where: { customerId: id, active: true } });
    return Object.assign(customer, { channels });
  }

  async updateCustomer(id: string, dto: UpdateCustomerDto, userId: string): Promise<Customer> {
    return this.dataSource.transaction(async (em) => {
      const customer = await em.findOne(Customer, { where: { id } });
      if (!customer) throw new NotFoundException(`Customer ${id} not found`);

      const changedFields: Record<string, [unknown, unknown]> = {};

      if (dto.customerName !== undefined && dto.customerName !== customer.customerName) {
        changedFields.customerName = [customer.customerName, dto.customerName];
        customer.customerName = dto.customerName;
      }
      if (dto.contactEmail !== undefined) { customer.contactEmail = dto.contactEmail ?? null; }
      if (dto.contactPhone !== undefined) { customer.contactPhone = dto.contactPhone ?? null; }
      if (dto.customerType !== undefined && dto.customerType !== customer.customerType) {
        changedFields.customerType = [customer.customerType, dto.customerType];
        customer.customerType = dto.customerType;
      }

      const saved = await em.save(Customer, customer);

      await this._audit(em, {
        entityType: 'CUSTOMER',
        entityId: id,
        action: 'UPDATE',
        changedFields,
        changedBy: userId,
      });

      return saved;
    });
  }

  async deactivateCustomer(id: string, userId: string): Promise<void> {
    return this.dataSource.transaction(async (em) => {
      const customer = await em.findOne(Customer, { where: { id } });
      if (!customer) throw new NotFoundException(`Customer ${id} not found`);
      if (!customer.active) throw new BadRequestException(`Customer ${id} is already inactive`);

      customer.active = false;
      await em.save(Customer, customer);

      // Deactivate all channel links
      const links = await em.find(CustomerCn, { where: { customerId: id, active: true } });
      for (const link of links) {
        link.active = false;
        await em.save(CustomerCn, link);
      }

      await this._audit(em, {
        entityType: 'CUSTOMER',
        entityId: id,
        action: 'DELETE',
        changedFields: { active: [true, false] },
        changedBy: userId,
      });
    });
  }

  // ─── Customer ↔ Channel links ────────────────────────────────────────────────

  async linkCustomerCn(
    customerId: string,
    cnId: string,
    isPrimary: boolean,
    userId: string,
  ): Promise<CustomerCn> {
    return this.dataSource.transaction(async (em) => {
      const customer = await em.findOne(Customer, { where: { id: customerId } });
      if (!customer) throw new NotFoundException(`Customer ${customerId} not found`);

      const channel = await em.findOne(Channel, { where: { id: cnId } });
      if (!channel) throw new NotFoundException(`Channel ${cnId} not found`);

      // Primary uniqueness check: only 1 active primary CN per customer
      if (isPrimary) {
        const existingPrimary = await em.findOne(CustomerCn, {
          where: { customerId, isPrimary: true, active: true },
        });
        if (existingPrimary && existingPrimary.cnId !== cnId) {
          throw new BadRequestException(
            `Customer ${customerId} already has a primary channel (cnId=${existingPrimary.cnId}). ` +
            `Unlink it first or set isPrimary=false.`,
          );
        }
      }

      // Upsert existing link
      let link = await em.findOne(CustomerCn, { where: { customerId, cnId } });
      const isNew = !link;

      if (!link) {
        link = em.create(CustomerCn, { customerId, cnId, isPrimary, active: true });
      } else {
        link.isPrimary = isPrimary;
        link.active = true;
      }

      const saved = await em.save(CustomerCn, link);

      await this._audit(em, {
        entityType: 'CUSTOMER_CN',
        entityId: customerId,
        action: isNew ? 'CREATE' : 'UPDATE',
        changedFields: { cnId, isPrimary },
        changedBy: userId,
      });

      return saved;
    });
  }

  async unlinkCustomerCn(customerId: string, cnId: string, userId: string): Promise<void> {
    return this.dataSource.transaction(async (em) => {
      const link = await em.findOne(CustomerCn, { where: { customerId, cnId, active: true } });
      if (!link) {
        throw new NotFoundException(`Active link between customer ${customerId} and channel ${cnId} not found`);
      }

      link.active = false;
      await em.save(CustomerCn, link);

      await this._audit(em, {
        entityType: 'CUSTOMER_CN',
        entityId: customerId,
        action: 'DELETE',
        changedFields: { cnId, active: [true, false] },
        changedBy: userId,
      });
    });
  }

  // ─── GET /audit ───────────────────────────────────────────────────────────────

  async getAuditLog(
    query: AuditQueryDto,
  ): Promise<PaginatedResponse<MasterDataAuditLog>> {
    const { page, pageSize } = query;
    const { skip, take } = skipTake(page, pageSize);

    const qb = this.auditRepo.createQueryBuilder('a');

    if (query.entityType) qb.andWhere('a.entity_type = :et', { et: query.entityType });
    if (query.entityId) qb.andWhere('a.entity_id = :ei', { ei: query.entityId });
    if (query.action) qb.andWhere('a.action = :action', { action: query.action });
    if (query.changedBy) qb.andWhere('a.changed_by ILIKE :cb', { cb: `%${query.changedBy}%` });

    qb.orderBy('a.changed_at', 'DESC').skip(skip).take(take);
    const [data, total] = await qb.getManyAndCount();

    return paginate(data, total, page, pageSize);
  }

  // ─── M28 EXTEND: programmatic LT auto-update (R11 separation of concerns) ────

  /**
   * M28 calls this after computing rolling 6-month avg LT.
   * Applies drift gate (>30% → block, drift_count++; ≥3 consecutive → force apply).
   * Returns action taken + new drift_count for lt_actual_log audit.
   */
  async autoUpdateLt(
    supplierCode: string,
    newLtDays: number,
    actor: string,
  ): Promise<{ action: 'APPLIED' | 'DRIFT_BLOCKED' | 'DRIFT_FORCE_APPLY'; driftCountAfter: number }> {
    return this.dataSource.transaction(async (em) => {
      const supplier = await em.findOne(Supplier, { where: { supplierCode } });
      if (!supplier) {
        return { action: 'DRIFT_BLOCKED' as const, driftCountAfter: 0 };
      }

      const oldLt     = supplier.leadTimeDays ?? newLtDays;
      const driftPct  = oldLt > 0 ? Math.abs(newLtDays - oldLt) / oldLt * 100 : 0;
      const driftCount = supplier.ltDriftCount ?? 0;
      const isForce   = driftCount >= 2 && driftPct > 30;
      const shouldApply = driftPct <= 30 || isForce;

      const action: 'APPLIED' | 'DRIFT_BLOCKED' | 'DRIFT_FORCE_APPLY' = shouldApply
        ? (isForce ? 'DRIFT_FORCE_APPLY' : 'APPLIED')
        : 'DRIFT_BLOCKED';

      if (shouldApply) {
        supplier.leadTimeDays   = Math.round(newLtDays * 10) / 10;
        supplier.ltDriftCount   = 0; // reset on successful apply
        supplier.ltDriftLastAt  = new Date();
      } else {
        supplier.ltDriftCount   = driftCount + 1;
        supplier.ltDriftLastAt  = new Date();
      }
      await em.save(Supplier, supplier);

      await this._audit(em, {
        entityType: 'SUPPLIER',
        entityId:   supplierCode,
        action:     'UPDATE',
        changedFields: { leadTimeDays: [oldLt, shouldApply ? newLtDays : oldLt], actor, action, driftPct },
        changedBy:  actor,
      });

      return { action, driftCountAfter: supplier.ltDriftCount };
    });
  }

  /**
   * M28 calls this to update transport_lane.lt_days for a NM→CN route.
   * H2 fix: full drift_count tracking + DRIFT_FORCE_APPLY (same pattern as autoUpdateLt).
   */
  async updateTransitLt(
    nmCode: string,
    cnCode: string,
    newLtDays: number,
    actor: string,
  ): Promise<{ action: 'APPLIED' | 'DRIFT_BLOCKED' | 'DRIFT_FORCE_APPLY'; driftCountAfter: number }> {
    const lane: Array<{ id: string; lt_days: number | null; lt_drift_count: number }> =
      await this.dataSource.query(
        `SELECT id::text, lt_days::float, COALESCE(lt_drift_count, 0)::int AS lt_drift_count
         FROM transport_lane
         WHERE source_location_code = $1 AND dest_location_code = $2 AND is_active = TRUE
         LIMIT 1`,
        [nmCode, cnCode],
      );
    if (lane.length === 0) return { action: 'DRIFT_BLOCKED', driftCountAfter: 0 };

    const { id, lt_drift_count: driftCount } = lane[0];
    const oldLt    = lane[0].lt_days ?? newLtDays;
    const driftPct = oldLt > 0 ? Math.abs(newLtDays - oldLt) / oldLt * 100 : 0;
    const isForce  = driftCount >= 2 && driftPct > 30;
    const shouldApply = driftPct <= 30 || isForce;

    const action: 'APPLIED' | 'DRIFT_BLOCKED' | 'DRIFT_FORCE_APPLY' = shouldApply
      ? (isForce ? 'DRIFT_FORCE_APPLY' : 'APPLIED')
      : 'DRIFT_BLOCKED';

    const newCount = shouldApply ? 0 : driftCount + 1;
    await this.dataSource.query(
      `UPDATE transport_lane
         SET lt_days = CASE WHEN $1 THEN $2 ELSE lt_days END,
             lt_drift_count = $3,
             lt_drift_last_at = NOW()
       WHERE id = $4`,
      [shouldApply, Math.round(newLtDays * 10) / 10, newCount, id],
    );

    return { action, driftCountAfter: newCount };
  }
}
