import { ItemSaveValidationDTO } from '../SaveValidator/ItemSaveValidationDTO'
import { ItemSaveRuleResult } from './ItemSaveRuleResult'
import { ItemSaveRuleInterface } from './ItemSaveRuleInterface'
import { ConflictType } from '@standardnotes/responses'
import { GroupUserServiceInterface } from '../../GroupUser/Service/GroupUserServiceInterface'
import { ItemHash } from '../ItemHash'
import { GroupUserPermission } from '../../GroupUser/Model/GroupUserPermission'
import { GroupServiceInterface } from '../../Group/Service/GroupServiceInterface'
import { ContentType } from '@standardnotes/common'

export class OwnershipFilter implements ItemSaveRuleInterface {
  constructor(private groupService: GroupServiceInterface, private groupUserService: GroupUserServiceInterface) {}

  async check(dto: ItemSaveValidationDTO): Promise<ItemSaveRuleResult> {
    const itemBelongsToADifferentUser = dto.existingItem != null && dto.existingItem.userUuid !== dto.userUuid

    const successValue = {
      passed: true,
    }

    const groupReadonlyFail = {
      passed: false,
      conflict: {
        unsavedItem: dto.itemHash,
        type: ConflictType.ReadOnlyError,
      },
    }

    const ownershipFail = {
      passed: false,
      conflict: {
        unsavedItem: dto.itemHash,
        type: ConflictType.UuidConflict,
      },
    }

    const groupUuidInvolved = dto.existingItem?.groupUuid || dto.itemHash.group_uuid
    if (itemBelongsToADifferentUser && !groupUuidInvolved) {
      return ownershipFail
    }

    if (groupUuidInvolved) {
      const groupAuthorization = await this.groupAuthorizationForItem(dto.userUuid, groupUuidInvolved)
      if (!groupAuthorization) {
        return ownershipFail
      }

      if (groupAuthorization === 'read') {
        return groupReadonlyFail
      }

      const isItemBeingRemovedFromGroup =
        dto.existingItem != null && dto.existingItem.groupUuid != null && dto.itemHash.group_uuid == null

      const isItemBeingDeleted = dto.itemHash.deleted === true

      if (isItemBeingRemovedFromGroup || isItemBeingDeleted) {
        if (itemBelongsToADifferentUser) {
          return groupAuthorization === 'admin' ? successValue : groupReadonlyFail
        } else {
          return successValue
        }
      }

      if (dto.itemHash.content_type === ContentType.SharedItemsKey && groupAuthorization !== 'admin') {
        return groupReadonlyFail
      }

      const usingValidKey = await this.groupItemIsBeingSavedWithValidItemsKey(dto.itemHash)

      if (!usingValidKey) {
        return {
          passed: false,
          conflict: {
            unsavedItem: dto.itemHash,
            type: ConflictType.ContentError,
          },
        }
      }
    }

    return successValue
  }

  private async groupItemIsBeingSavedWithValidItemsKey(itemHash: ItemHash): Promise<boolean> {
    const isItemNotEncryptedByItemsKey = itemHash.content_type === ContentType.SharedItemsKey
    if (isItemNotEncryptedByItemsKey) {
      return true
    }

    const group = await this.groupService.getGroup({ groupUuid: itemHash.group_uuid as string })

    if (!group) {
      return false
    }

    return itemHash.items_key_id === group.specifiedItemsKeyUuid
  }

  private async groupAuthorizationForItem(
    userUuid: string,
    groupUuid: string,
  ): Promise<GroupUserPermission | undefined> {
    const groupUser = await this.groupUserService.getUserForGroup({
      userUuid,
      groupUuid: groupUuid,
    })

    if (groupUser) {
      return groupUser.permissions
    }

    return undefined
  }
}
