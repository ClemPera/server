import { Repository, SelectQueryBuilder } from 'typeorm'
import { MapperInterface, Uuid } from '@standardnotes/domain-core'
import { Logger } from 'winston'

import { Item } from '../../Domain/Item/Item'
import { ItemQuery } from '../../Domain/Item/ItemQuery'
import { ItemRepositoryInterface } from '../../Domain/Item/ItemRepositoryInterface'
import { ExtendedIntegrityPayload } from '../../Domain/Item/ExtendedIntegrityPayload'
import { SQLLegacyItem } from './SQLLegacyItem'
import { ItemContentSizeDescriptor } from '../../Domain/Item/ItemContentSizeDescriptor'

export class SQLLegacyItemRepository implements ItemRepositoryInterface {
  constructor(
    protected ormRepository: Repository<SQLLegacyItem>,
    protected mapper: MapperInterface<Item, SQLLegacyItem>,
    protected logger: Logger,
  ) {}

  async deleteByUserUuidInSharedVaults(_userUuid: Uuid, _sharedVaultUuids: Uuid[]): Promise<void> {
    this.logger.error('Method deleteByUserUuidInSharedVaults not supported.')
  }

  async updateSharedVaultOwner(_dto: { sharedVaultUuid: Uuid; fromOwnerUuid: Uuid; toOwnerUuid: Uuid }): Promise<void> {
    this.logger.error('Method updateSharedVaultOwner not supported.')
  }

  async unassignFromSharedVault(_sharedVaultUuid: Uuid): Promise<void> {
    this.logger.error('Method unassignFromSharedVault not supported.')
  }

  async removeByUuid(uuid: Uuid): Promise<void> {
    await this.ormRepository
      .createQueryBuilder('item')
      .delete()
      .from('items')
      .where('uuid = :uuid', { uuid: uuid.value })
      .execute()
  }

  async insert(item: Item): Promise<void> {
    const projection = this.mapper.toProjection(item)

    await this.ormRepository.insert(projection)
  }

  async update(item: Item): Promise<void> {
    const projection = this.mapper.toProjection(item)

    const { uuid, ...updateValues } = projection

    await this.ormRepository.update({ uuid: uuid }, updateValues)
  }

  async remove(item: Item): Promise<void> {
    await this.ormRepository.remove(this.mapper.toProjection(item))
  }

  async updateContentSize(itemUuid: string, contentSize: number): Promise<void> {
    await this.ormRepository
      .createQueryBuilder('item')
      .update()
      .set({
        contentSize,
      })
      .where('uuid = :itemUuid', {
        itemUuid,
      })
      .execute()
  }

  async findContentSizeForComputingTransferLimit(query: ItemQuery): Promise<ItemContentSizeDescriptor[]> {
    const queryBuilder = this.createFindAllQueryBuilder(query)
    queryBuilder.select('item.uuid', 'uuid')
    queryBuilder.addSelect('item.content_size', 'contentSize')

    const items = await queryBuilder.getRawMany()

    const itemContentSizeDescriptors: ItemContentSizeDescriptor[] = []
    for (const item of items) {
      const ItemContentSizeDescriptorOrError = ItemContentSizeDescriptor.create(item.uuid, item.contentSize)
      if (ItemContentSizeDescriptorOrError.isFailed()) {
        this.logger.error(
          `Failed to create ItemContentSizeDescriptor for item ${
            item.uuid
          }: ${ItemContentSizeDescriptorOrError.getError()}`,
        )
        continue
      }
      itemContentSizeDescriptors.push(ItemContentSizeDescriptorOrError.getValue())
    }

    return itemContentSizeDescriptors
  }

  async deleteByUserUuidAndNotInSharedVault(userUuid: Uuid): Promise<void> {
    await this.ormRepository
      .createQueryBuilder('item')
      .delete()
      .from('items')
      .where('user_uuid = :userUuid', { userUuid: userUuid.value })
      .execute()
  }

  async findByUuid(uuid: Uuid): Promise<Item | null> {
    const persistence = await this.ormRepository
      .createQueryBuilder('item')
      .where('item.uuid = :uuid', {
        uuid: uuid.value,
      })
      .getOne()

    if (persistence === null) {
      return null
    }

    try {
      const item = this.mapper.toDomain(persistence)

      return item
    } catch (error) {
      this.logger.error(
        `Failed to map item ${uuid.value} for user ${persistence.userUuid} by uuid: ${(error as Error).message}`,
      )

      return null
    }
  }

  async findDatesForComputingIntegrityHash(userUuid: string): Promise<Array<{ updated_at_timestamp: number }>> {
    const queryBuilder = this.ormRepository.createQueryBuilder('item')
    queryBuilder.select('item.updated_at_timestamp')
    queryBuilder.where('item.user_uuid = :userUuid', { userUuid: userUuid })
    queryBuilder.andWhere('item.deleted = :deleted', { deleted: false })

    const items = await queryBuilder.getRawMany()

    return items.sort((itemA, itemB) => itemB.updated_at_timestamp - itemA.updated_at_timestamp)
  }

  async findItemsForComputingIntegrityPayloads(userUuid: string): Promise<ExtendedIntegrityPayload[]> {
    const queryBuilder = this.ormRepository.createQueryBuilder('item')
    queryBuilder.select('item.uuid', 'uuid')
    queryBuilder.addSelect('item.updated_at_timestamp', 'updated_at_timestamp')
    queryBuilder.addSelect('item.content_type', 'content_type')
    queryBuilder.where('item.user_uuid = :userUuid', { userUuid: userUuid })
    queryBuilder.andWhere('item.deleted = :deleted', { deleted: false })

    const items = await queryBuilder.getRawMany()

    return items.sort((itemA, itemB) => itemB.updated_at_timestamp - itemA.updated_at_timestamp)
  }

  async findByUuidAndUserUuid(uuid: string, userUuid: string): Promise<Item | null> {
    const persistence = await this.ormRepository
      .createQueryBuilder('item')
      .where('item.uuid = :uuid AND item.user_uuid = :userUuid', {
        uuid,
        userUuid,
      })
      .getOne()

    if (persistence === null) {
      return null
    }

    try {
      const item = this.mapper.toDomain(persistence)

      return item
    } catch (error) {
      this.logger.error(
        `Failed to map item ${uuid} for user ${persistence.userUuid} by uuid and userUuid: ${(error as Error).message}`,
      )

      return null
    }
  }

  async findAll(query: ItemQuery): Promise<Item[]> {
    const persistence = await this.createFindAllQueryBuilder(query).getMany()

    const domainItems: Item[] = []
    for (const persistencItem of persistence) {
      try {
        domainItems.push(this.mapper.toDomain(persistencItem))
      } catch (error) {
        this.logger.error(
          `Failed to map item ${persistencItem.uuid} for user ${persistencItem.userUuid} to domain: ${
            (error as Error).message
          }`,
        )
      }
    }

    return domainItems
  }

  async countAll(query: ItemQuery): Promise<number> {
    return this.createFindAllQueryBuilder(query).getCount()
  }

  async markItemsAsDeleted(itemUuids: Array<string>, updatedAtTimestamp: number): Promise<void> {
    await this.ormRepository
      .createQueryBuilder('item')
      .update()
      .set({
        deleted: true,
        content: null,
        encItemKey: null,
        authHash: null,
        updatedAtTimestamp,
      })
      .where('uuid IN (:...uuids)', {
        uuids: itemUuids,
      })
      .execute()
  }

  protected createFindAllQueryBuilder(query: ItemQuery): SelectQueryBuilder<SQLLegacyItem> {
    const queryBuilder = this.ormRepository.createQueryBuilder('item')

    if (query.sortBy !== undefined && query.sortOrder !== undefined) {
      queryBuilder.orderBy(`item.${query.sortBy}`, query.sortOrder)
    }

    if (query.userUuid !== undefined) {
      queryBuilder.where('item.user_uuid = :userUuid', { userUuid: query.userUuid })
    }

    if (query.uuids && query.uuids.length > 0) {
      queryBuilder.andWhere('item.uuid IN (:...uuids)', { uuids: query.uuids })
    }
    if (query.deleted !== undefined) {
      queryBuilder.andWhere('item.deleted = :deleted', { deleted: query.deleted })
    }
    if (query.contentType) {
      if (Array.isArray(query.contentType)) {
        queryBuilder.andWhere('item.content_type IN (:...contentTypes)', { contentTypes: query.contentType })
      } else {
        queryBuilder.andWhere('item.content_type = :contentType', { contentType: query.contentType })
      }
    }
    if (query.lastSyncTime && query.syncTimeComparison) {
      queryBuilder.andWhere(`item.updated_at_timestamp ${query.syncTimeComparison} :lastSyncTime`, {
        lastSyncTime: query.lastSyncTime,
      })
    }
    if (query.createdBetween !== undefined) {
      queryBuilder.andWhere('item.created_at >= :createdAfter AND item.created_at <= :createdBefore', {
        createdAfter: query.createdBetween[0].toISOString(),
        createdBefore: query.createdBetween[1].toISOString(),
      })
    }
    if (query.offset !== undefined) {
      queryBuilder.skip(query.offset)
    }
    if (query.limit !== undefined) {
      queryBuilder.take(query.limit)
    }

    return queryBuilder
  }
}
