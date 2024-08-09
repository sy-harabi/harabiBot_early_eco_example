const config = require("./config")
const constant = require("./constant")
const mapUtils = require("./mapUtils")
const profiler = require("./profiler")
const screepsProfiler = require("./screeps-profiler")
const basePlanner = require("./util_base_planner")

const roomUtils = {
  /**
   * @callback pullIdlerCallback
   * @param {Creep} creep
   */

  /**
   *
   * @param {Room} room
   * @param {pullIdlerCallback} callback
   * @returns
   */
  pullIdler(room, callback) {
    const idlers = roomUtils.getCreepsByRole(room, "idler")

    for (const idler of idlers) {
      if (idler.memory.role || !callback(idler)) {
        continue
      }

      return idler
    }
  },

  /**
   *
   * @param {Room} room
   * @returns {[Creep]}
   */
  findSourceKeepers(room) {
    if (room._sourceKeepers) {
      return room._sourceKeepers
    }

    const hostileCreeps = room.find(FIND_HOSTILE_CREEPS)

    room._sourceKeepers = hostileCreeps.filter((creep) => creep.owner.username === constant.SOURCE_KEEPER_NAME)

    return room._sourceKeepers
  },

  addSpawnBalance(room) {
    if (room._spawnBalanceAdded) {
      return
    }

    room._spawnBalanceAdded = true

    room.memory.spawnBalance = Math.min(room.memory.spawnBalance + 0.02, 1)
  },

  subtractSpawnBalance(room) {
    if (room._spawnBalanceSubtracted) {
      return
    }

    room._spawnBalanceSubtracted = true

    room.memory.spawnBalance = Math.max(room.memory.spawnBalance - 0.02, -1)
  },

  /**
   * find all the hostile creeps and power creeps, considering allies
   * @param {Room} room
   * @returns {[Creep]}
   */
  findHostileCreeps(room) {
    if (room._hostileCreeps) {
      return room._hostileCreeps
    }

    const hostileCreeps = room.find(FIND_HOSTILE_CREEPS).concat(room.find(FIND_HOSTILE_POWER_CREEPS))

    if (config.diplomacy.allies.length > 0) {
      room._hostileCreeps = hostileCreeps.filter((creep) => !config.diplomacy.allies.includes(creep.owner.username))
    } else {
      room._hostileCreeps = hostileCreeps
    }

    return room._hostileCreeps
  },

  isStronghold(targetRoomName) {
    const type = mapUtils.getRoomType(targetRoomName)

    if (type !== constant.ROOM_TYPE_KEEPER) {
      return false
    }

    Memory.rooms[targetRoomName] = Memory.rooms[targetRoomName] || {}

    const memory = Memory.rooms[targetRoomName]

    const invaderCoreInfo = memory.invaderCore

    const targetRoom = Game.rooms[targetRoomName]

    if (!targetRoom) {
      if (!invaderCoreInfo) {
        return false
      }

      if (invaderCoreInfo.ticksToCollapse && Game.time < invaderCoreInfo.ticksToCollapse) {
        Game.map.visual.text(invaderCoreInfo.ticksToCollapse - Game.time, new RoomPosition(40, 5, targetRoomName), {
          fontSize: 6,
        })
        return true
      }

      return false
    }

    const invaderCore = targetRoom
      .find(FIND_HOSTILE_STRUCTURES)
      .find((structure) => structure.structureType === STRUCTURE_INVADER_CORE)

    if (!invaderCore) {
      delete memory.invaderCore
      return false
    }

    const info = {}

    info.level = invaderCore.level

    if (invaderCore.ticksToDeploy) {
      info.deployTime = Game.time + invaderCore.ticksToDeploy
      memory.invaderCore = info
      return false
    } else {
      const effects = invaderCore.effects
      for (const effectInfo of effects) {
        if (effectInfo.effect === EFFECT_COLLAPSE_TIMER) {
          info.ticksToCollapse = Game.time + effectInfo.ticksRemaining
          memory.invaderCore = info
          return true
        }
      }
    }
  },

  /**
   *
   * @param {Room} room
   * @returns {RoomPosition}
   */
  getStartPos(room) {
    if (!room.my) {
      return
    }

    if (room.heap._startPos) {
      return room.heap._startPos
    }

    const basePlan = basePlanner.getBasePlan(room.name)
    const startCoord = basePlan.startCoord

    const startPos = new RoomPosition(startCoord.x, startCoord.y, room.name)

    room.heap._startPos = startPos

    return startPos
  },

  /**
   *
   * @param {Room} room
   * @returns {RoomPosition}
   */
  getStoragePos(room) {
    if (!room.my) {
      return
    }

    if (room.heap._storagePos) {
      return room.heap._storagePos
    }

    const basePlan = basePlanner.getBasePlan(room.name)
    const startCoord = basePlan.startCoord

    const storagePos = new RoomPosition(startCoord.x - 1, startCoord.y + 1, room.name)

    room.heap._storagePos = storagePos

    return storagePos
  },

  /**
   *
   * @param {Room} room
   * @returns {number}
   */
  getEnergyLevel(room) {
    if (room._energyLevel) {
      return room._energyLevel
    }

    const totalEnergy =
      this.getResourceAmount(room, RESOURCE_ENERGY) + 10 * this.getResourceAmount(room, RESOURCE_BATTERY)

    const standerd = config.economy.energyStandard[room.controller.level]

    const result = Math.floor(100 * (totalEnergy / standerd))

    room._energyLevel = result

    return result
  },

  /**
   *
   * @param {Room} room
   * @param {string} resourceType
   * @returns {number}
   */
  getResourceAmount(room, resourceType) {
    const storage = room.storage
    const factories = this.getStructuresByType(room, STRUCTURE_FACTORY)
    const terminal = room.terminal

    let result = 0

    if (storage) {
      result += storage.store[resourceType] || 0
    }

    if (factories) {
      for (const factory of factories) {
        result += factory.store[resourceType] || 0
      }
    }

    if (terminal) {
      result += terminal.store[resourceType] || 0
    }

    return result
  },

  /**
   *
   * @param {Room} room
   * @param {string} role
   * @returns {[Creep]}
   */
  getCreepsByRole(room, role) {
    if (!room.creeps) {
      return []
    }

    if (!room.creeps[role]) {
      return []
    }

    return room.creeps[role]
  },

  /**
   *
   * @param {Room} room
   * @param {string} structureType
   * @returns
   */
  getStructuresByType(room, structureType) {
    if (room._structures && room._structures[structureType]) {
      return room._structures[structureType]
    }

    const structures = this.getStructures(room)

    room._structures = room._structures || {}

    const structureIds = structures[structureType]

    room._structures[structureType] = []

    if (structureIds) {
      structureIds.forEach((id) => {
        const structure = Game.getObjectById(id)
        if (structure) {
          room._structures[structureType].push(structure)
          return
        }
        room.heap._structures = undefined
      })
    }

    return room._structures[structureType]
  },

  /**
   *
   * @param {Room} room
   * @returns {object}
   */
  getStructures(room) {
    if (room.heap._structures && Game.time < room.heap._structuresTick + 11) {
      return room.heap._structures
    }

    const result = (room.heap._structures = {})

    room.heap._structuresTick = Game.time

    for (const structure of room.find(FIND_STRUCTURES)) {
      result[structure.structureType] = result[structure.structureType] || []
      result[structure.structureType].push(structure.id)

      if (
        room.my &&
        structure.structureType === STRUCTURE_ROAD &&
        structure.hits / structure.hitsMax < config.economy.roadRepairThreshold
      ) {
        result.damaged = result.damaged || []
        result.damaged.push(structure.id)
      }
    }

    return result
  },

  /**
   *
   * @param {Room} room
   * @returns {RoomPosition}
   */
  getControllerLinkPos(room) {
    if (!room.my) {
      return undefined
    }

    if (room.heap._controllerContainerPos !== undefined) {
      return room.heap._controllerContainerPos
    }

    const basePlan = basePlanner.getBasePlan(room.name)

    const coord = basePlan.links.controller

    return (room.heap._controllerContainerPos = new RoomPosition(coord.x, coord.y, room.name))
  },

  /**
   *
   * @param {Room} room
   * @returns
   */
  getControllerContainer(room) {
    if (!room.my) {
      return undefined
    }

    if (room._controllerContainer !== undefined) {
      return room._controllerContainer
    }

    if (room.heap.controllerContainerId !== undefined) {
      const controllerContainer = Game.getObjectById(room.heap.controllerContainerId)

      if (controllerContainer) {
        room._controllerContainer = controllerContainer
        return controllerContainer
      }
    }

    const basePlan = basePlanner.getBasePlan(room.name)

    const controllerLinkCoord = basePlan.links.controller

    const controllerContainer = room
      .lookForAt(LOOK_STRUCTURES, controllerLinkCoord.x, controllerLinkCoord.y)
      .find((structure) => structure.structureType === STRUCTURE_CONTAINER)

    if (controllerContainer) {
      room.heap.controllerContainerId = controllerContainer.id
      room._controllerContainer = controllerContainer
      return controllerContainer
    }

    room._controllerContainer = null
    return undefined
  },

  /**
   *
   * @param {Room} room
   * @returns {StructureLink}
   */
  getStorageLink(room) {
    if (!room.my) {
      return undefined
    }

    if (room._storageLink !== undefined) {
      return room._storageLink
    }

    if (room.heap.storageLinkId !== undefined) {
      const storageLink = Game.getObjectById(room.heap.storageLinkId)

      if (storageLink) {
        room._storageLink = storageLink
        return storageLink
      }
    }

    const basePlan = basePlanner.getBasePlan(room.name)

    const storageLinkCoord = basePlan.links.storage

    const storageLink = room
      .lookForAt(LOOK_STRUCTURES, storageLinkCoord.x, storageLinkCoord.y)
      .find((structure) => structure.structureType === STRUCTURE_LINK)

    if (storageLink) {
      room._storageLink = storageLink
      room.heap.storageLinkId = storageLink.id
      return storageLink
    }

    room._storageLink = null
    return null
  },

  /**
   *
   * @param {Room} room
   * @returns {StructureLink}
   */
  getSourceLinks(room) {
    if (!room.my) {
      return undefined
    }

    if (room._sourceLinks !== undefined) {
      return room._sourceLinks
    }

    if (
      room.heap.sourceLinkIds !== undefined &&
      (Object.keys(room.heap.sourceLinkIds).length >= room.controller.level - 5 || Math.random() < 0.99)
    ) {
      const sourceLinks = {}

      let useCache = true

      Object.entries(room.heap.sourceLinkIds).forEach(([sourceId, linkId]) => {
        const link = Game.getObjectById(linkId)
        if (!link) {
          useCache = false
          return
        }

        sourceLinks[sourceId] = link
      })

      if (useCache) {
        room._sourceLinks = sourceLinks
        return sourceLinks
      }
    }

    const basePlan = basePlanner.getBasePlan(room.name)

    const sourceLinks = {}

    const sourceLinkIds = {}

    Object.entries(basePlan.links.sources).forEach(([id, coord]) => {
      const link = room
        .lookForAt(LOOK_STRUCTURES, coord.x, coord.y)
        .find((structure) => structure.structureType === STRUCTURE_LINK)

      if (link) {
        sourceLinks[id] = link
        sourceLinkIds[id] = link.id
      }
    })

    if (Object.keys(sourceLinkIds).length > 0) {
      room._sourceLinks = sourceLinks
      room.heap.sourceLinkIds = sourceLinkIds
      return sourceLinks
    }

    room._sourceLinks = {}
    return {}
  },

  /**
   *
   * @param {Room} room
   * @returns {StructureLink}
   */
  getControllerLink(room) {
    if (!room.my) {
      return undefined
    }

    if (room._controllerLink !== undefined) {
      return room._controllerLink
    }

    if (room.heap.controllerLinkId !== undefined) {
      const controllerLink = Game.getObjectById(room.heap.controllerLinkId)

      if (controllerLink) {
        room._controllerLink = controllerLink
        return controllerLink
      }
    }

    const basePlan = basePlanner.getBasePlan(room.name)

    const controllerLinkCoord = basePlan.links.controller

    const controllerLink = room
      .lookForAt(LOOK_STRUCTURES, controllerLinkCoord.x, controllerLinkCoord.y)
      .find((structure) => structure.structureType === STRUCTURE_LINK)

    if (controllerLink) {
      room.heap.controllerLinkId = controllerLink.id
      room._controllerLink = controllerLink
      return controllerLink
    }

    room._controllerLink = null
    return undefined
  },
}

if (config.test.profiler) {
  screepsProfiler.registerObject(roomUtils, "roomUtils")
}

module.exports = roomUtils
