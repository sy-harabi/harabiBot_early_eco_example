const config = require("./config")
const constant = require("./constant")
const coordUtils = require("./coordUtils")
const creepUtils = require("./creepUtils")
const mapUtils = require("./mapUtils")
const pathUtils = require("./pathUtils")
const roomUtils = require("./roomUtils")
const screepsProfiler = require("./screeps-profiler")
const basePlanner = require("./util_base_planner")

const SCOUT_INTERVAL = 1500

let manageScout = function (room) {
  if (Memory.resetScout) {
    Memory.resetScout = undefined

    room.heap._scoutMap = undefined
    room.memory.scoutTargetRoomName = undefined
    room.memory.scoutQueue = undefined

    for (const roomName in Memory.rooms) {
      Memory.rooms[roomName].intel = undefined
      Memory.rooms[roomName].remoteCheck = undefined
    }
  }

  const scoutMap = getScoutMap(room)

  const targetRoomName = getTargetRoomName(room, scoutMap)

  const distance = scoutMap.dist[targetRoomName]

  const targetRoom = Game.rooms[targetRoomName]

  if (!targetRoom) {
    getVision(room, targetRoomName)
    return
  }

  room.memory.completeScoutCurrent = true
  const intel = upadateIntel(targetRoom)

  if (!targetRoom.my && distance <= config.economy.maxRemoteRoomDistance && !intel[constant.SCOUT_KEYS.OWNER]) {
    const remotePlan = generateRemotePlan(room, targetRoom)
    if (remotePlan) {
      room.memory.remotes[targetRoom.name] = remotePlan
    }
  }
}

/**
 *
 * @param {Room} targetRoom
 */
function upadateIntel(targetRoom) {
  const existingIntel = mapUtils.getIntel(targetRoom.name) || {}

  const intel = {}

  intel[constant.SCOUT_KEYS.LAST_SCOUT] = Game.time

  // keys that never change
  intel[constant.SCOUT_KEYS.TYPE] = existingIntel[constant.SCOUT_KEYS.TYPE] || mapUtils.getRoomType(targetRoom.name)

  intel[constant.SCOUT_KEYS.SOURCE_COORDS_PACKED] =
    existingIntel[constant.SCOUT_KEYS.SOURCE_COORDS_PACKED] ||
    targetRoom.find(FIND_SOURCES).map((resource) => coordUtils.packCoord(resource.pos))

  intel[constant.SCOUT_KEYS.MINERAL_INFOS] =
    existingIntel[constant.SCOUT_KEYS.MINERAL_INFOS] ||
    targetRoom.find(FIND_MINERALS).map((resource) => {
      const mineralType = resource.mineralType
      const coordPacked = coordUtils.packCoord(resource.pos)
      return { mineralType, coordPacked }
    })

  if (
    intel[constant.SCOUT_KEYS.TYPE] === constant.ROOM_TYPE_KEEPER &&
    !intel[constant.SCOUT_KEYS.KEEPER_LAIR_COORDS_PACKED]
  ) {
    const keeperLairs = targetRoom
      .find(FIND_HOSTILE_STRUCTURES)
      .filter((structure) => structure.owner.username === constant.SOURCE_KEEPER_NAME)

    intel[constant.SCOUT_KEYS.KEEPER_LAIR_COORDS_PACKED] = keeperLairs.map((lair) => coordUtils.packCoord(lair.pos))
  }

  // keys that can change
  const controller = targetRoom.controller

  if (controller) {
    const owner = controller.owner ? controller.owner.username : undefined

    intel[constant.SCOUT_KEYS.CONTROLLER_COORD_PACKED] =
      existingIntel[constant.SCOUT_KEYS.CONTROLLER_COORD_PACKED] || coordUtils.packCoord(controller.pos)

    intel[constant.SCOUT_KEYS.OWNER] = owner

    if (owner) {
      intel[constant.SCOUT_KEYS.RCL] = controller.level
    }

    if (owner && owner !== constant.MY_NAME && config.diplomacy.allies.includes(owner)) {
      // update enemy info
    }

    intel[constant.SCOUT_KEYS.RESERVATION_OWNER] = controller.reservation ? controller.reservation.username : undefined
  }

  targetRoom.memory.intel = intel

  return intel
}

/**
 *
 * @param {Room} room
 * @param {Room} targetRoom
 */
function generateRemotePlan(room, targetRoom) {
  room.memory.remoteCheck = room.memory.remoteCheck || {}

  if (room.memory.remoteCheck[targetRoom.name]) {
    return undefined
  }

  room.memory.remoteCheck[room.name] = true

  const type = mapUtils.getRoomType(targetRoom.name)

  const sources = targetRoom.find(FIND_SOURCES)

  const sourceIds = []

  const minerals = targetRoom.find(FIND_MINERALS)

  const basePlan = basePlanner.getBasePlan(room.name)

  const startPos = roomUtils.getStoragePos(room)

  Memory.sourceInfos = Memory.sourceInfos || {}

  let controllerNumOpen

  if (type === constant.ROOM_TYPE_NORMAL) {
    const controller = targetRoom.controller

    controllerNumOpen = getNumOpen(targetRoom, controller.pos)
  }

  const intermediatesTotal = new Set()

  const roadCoords = getAllRemoteRoadPackedCoords(room)

  for (const source of sources) {
    const path = findRemotePath(startPos, source, basePlan, roadCoords)

    if (!path) {
      continue
    }

    if (path.length > config.economy.maxRemoteDistance) {
      continue
    }

    const info = {}

    info.type = type

    info.roomName = targetRoom.name

    info.parentRoomName = room.name

    info.distance = path.length

    info.energyPerTick =
      type === constant.ROOM_TYPE_NORMAL
        ? SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME
        : SOURCE_ENERGY_KEEPER_CAPACITY / ENERGY_REGEN_TIME

    info.numOpen = getNumOpen(targetRoom, source.pos)

    info.containerCoord = coordUtils.packCoord(path.pop())

    info.roadCoords = {}

    const intermediates = new Set()

    const keeperLairIdsToClean = new Set()

    for (const pos of path) {
      const roomName = pos.roomName

      const packed = coordUtils.packCoord(pos)

      info.roadCoords[roomName] = info.roadCoords[roomName] || []

      info.roadCoords[roomName].push(packed)

      roadCoords[roomName] = roadCoords[roomName] || []

      roadCoords[roomName].push(packed)

      if (![room.name, targetRoom.name].includes(roomName)) {
        intermediates.add(roomName)
        intermediatesTotal.add(roomName)
        continue
      }

      if (roomName === targetRoom.name && type === constant.ROOM_TYPE_KEEPER) {
        const keeperLairs = targetRoom
          .find(FIND_HOSTILE_STRUCTURES)
          .filter((structure) => structure.structureType === STRUCTURE_KEEPER_LAIR)

        for (const keeperLair of keeperLairs) {
          const keeperLairSource = keeperLair.pos.findInRange([...sources, ...minerals], 5)[0]
          if (pos.findInRange([keeperLair, keeperLairSource], 5).length > 0) {
            keeperLairIdsToClean.add(keeperLair.id)
          }
        }
      }
    }

    if (intermediates.size > 0) {
      info.intermediates = Array.from(intermediates)
    }

    if (type === constant.ROOM_TYPE_KEEPER) {
      info.keeperLairs = Array.from(keeperLairIdsToClean)
      info.energyPerTick += 630 / ENERGY_REGEN_TIME
    }

    sourceIds.push(source.id)
    Memory.sourceInfos[source.id] = info
  }

  const result = { type, controllerNumOpen, sourceIds, intermediates: Array.from(intermediatesTotal) }

  if (type === constant.ROOM_TYPE_NORMAL) {
    return result
  }

  Memory.mineralInfos = Memory.mineralInfos || {}

  for (const mineral of minerals) {
    const path = findRemotePath(startPos, mineral, basePlan)

    if (!path) {
      continue
    }

    const info = {}

    info.mineralType = mineral.mineralType

    info.distance = path.length - 1

    const intermediates = new Set()

    const keeperLairIdsToClean = new Set()

    for (const pos of path) {
      const roomName = pos.roomName

      if (![room.name, targetRoom.name].includes(roomName)) {
        intermediates.add(roomName)
        intermediatesTotal.add(roomName)
      }

      if (type === constant.ROOM_TYPE_KEEPER && roomName === targetRoom.name) {
        const keeperLairs = targetRoom
          .find(FIND_HOSTILE_STRUCTURES)
          .filter((structure) => structure.structureType === STRUCTURE_KEEPER_LAIR)

        for (const keeperLair of keeperLairs) {
          const keeperLairSource = keeperLair.pos.findInRange([...sources, ...minerals], 5)[0]
          if (pos.findInRange([keeperLair, keeperLairSource], 5).length > 0) {
            keeperLairIdsToClean.add(keeperLair.id)
          }
        }
      }
    }

    if (intermediates.size > 0) {
      info.intermediates = Array.from(intermediates)
    }

    if (type === constant.ROOM_TYPE_KEEPER) {
      info.keeperLairs = Array.from(keeperLairIdsToClean)
    }

    Memory.mineralInfos[mineral.id] = info
  }

  result.mineralIds = minerals.map((mineral) => mineral.id)

  return result
}

/**
 *
 * @param {Room} room
 */
function getAllRemoteRoadPackedCoords(room) {
  const result = {}

  for (const remoteName in room.memory.remotes) {
    for (const sourceId of room.memory.remotes[remoteName].sourceIds) {
      const sourceInfo = Memory.sourceInfos[sourceId]

      for (const roomName in sourceInfo.roadCoords) {
        result[roomName] = result[roomName] || []

        const roadPackedCoords = sourceInfo.roadCoords[roomName]

        for (const packed of roadPackedCoords) {
          result[roomName].push(packed)
        }
      }
    }
  }
  return result
}

function getNumOpen(room, pos) {
  const terrain = Game.map.getRoomTerrain(room.name)

  return coordUtils.getCoordsAtRange(pos, 1).filter((coord) => {
    if (terrain.get(coord.x, coord.y) === TERRAIN_MASK_WALL) {
      return false
    }
    if (
      room
        .lookForAt(LOOK_STRUCTURES, coord.x, coord.y)
        .some((structure) => OBSTACLE_OBJECT_TYPES.includes(structure.structureType))
    ) {
      return false
    }
    return true
  }).length
}

function findRemotePath(startPos, resource, basePlan, roadCoords) {
  const thisRoomName = startPos.roomName

  const search = PathFinder.search(
    startPos,
    { pos: resource.pos, range: 1 },
    {
      plainCost: 5,
      swampCost: 6,
      maxOps: 20000,
      heuristicWeight: 1,
      roomCallback: function (roomName) {
        const costs = new PathFinder.CostMatrix()

        if (roadCoords && roadCoords[roomName]) {
          for (const packed of roadCoords[roomName]) {
            const unpacked = coordUtils.unpackCoord(packed)
            costs.set(unpacked.x, unpacked.y, 4)
          }
        }

        const currentRoom = Game.rooms[roomName]

        if (!currentRoom) {
          return costs
        }

        const terrain = Game.map.getRoomTerrain(roomName)

        currentRoom.find(FIND_STRUCTURES).forEach(function (structure) {
          if (structure.structureType === STRUCTURE_CONTROLLER) {
            coordUtils.getCoordsInRange(structure.pos, 1).forEach((coord) => {
              if (terrain.get(coord.x, coord.y) === TERRAIN_MASK_WALL) {
                return
              }

              if (costs.get(coord.x, coord.y) < 50) {
                costs.set(coord.x, coord.y, 50)
              }
            })
          }

          if (OBSTACLE_OBJECT_TYPES.includes(structure.structureType)) {
            costs.set(structure.pos.x, structure.pos.y, 255)
            return
          }

          if (structure.structureType === STRUCTURE_ROAD && costs.get(structure.pos.x, structure.pos.y) < 4) {
            costs.set(structure.pos.x, structure.pos.y, 4)
            return
          }
        })

        const currentRoomResources = [...currentRoom.find(FIND_SOURCES), ...currentRoom.find(FIND_MINERALS)]

        for (const currentRoomResource of currentRoomResources) {
          if (resource.id === currentRoomResource.id) {
            continue
          }
          for (const coord of coordUtils.getCoordsAtRange(currentRoomResource.pos, 1)) {
            if (terrain.get(coord.x, coord.y) !== TERRAIN_MASK_WALL && costs.get(coord.x, coord.y) < 50) {
              costs.set(coord.x, coord.y, 50)
            }
          }
        }

        if (roomName === thisRoomName && basePlan) {
          for (let i = 1; i <= 8; i++) {
            for (const unpacked of basePlan.structures[i]) {
              if (unpacked.structureType === STRUCTURE_ROAD) {
                costs.set(unpacked.coord.x, unpacked.coord.y, 4)
                continue
              }

              if (OBSTACLE_OBJECT_TYPES.includes(unpacked.structureType)) {
                costs.set(unpacked.coord.x, unpacked.coord.y, 255)
              }
            }
          }
        }

        return costs
      },
    },
  )

  if (search.incomplete) {
    return undefined
  }

  return search.path
}

/**
 *
 * @param {Room} room
 * @returns
 */
function getScoutMap(room) {
  if (room.heap._scoutMapTime && Game.time > room.heap._scoutMapTime + SCOUT_INTERVAL) {
    room.heap._scoutMap = undefined
  }

  if (room.heap._scoutMap !== undefined) {
    return room.heap._scoutMap
  }

  room.heap._scoutMapTime = Game.time

  room.heap._scoutMap = pathUtils.getMapShortestPathTree(room.name)

  return room.heap._scoutMap
}

/**
 * @param {Room} room
 * @param {mapShortestPathTree} scoutMap
 * @returns {string}
 */
function getTargetRoomName(room, scoutMap) {
  if (room.memory.scoutTargetRoomName && !room.memory.completeScoutCurrent) {
    return room.memory.scoutTargetRoomName
  }

  room.memory.completeScoutCurrent = false

  if (room.memory.scoutQueue && room.memory.scoutQueue.length > 0) {
    room.memory.scoutTargetRoomName = room.memory.scoutQueue.shift()
    return room.memory.scoutTargetRoomName
  }

  room.memory.scoutQueue = scoutMap.sorted

  room.memory.scoutTargetRoomName = room.memory.scoutQueue.shift()

  return room.memory.scoutTargetRoomName
}

/**
 *
 * @param {Room} room
 * @param {string} targetRoomName
 * @returns
 */
function getVision(room, targetRoomName) {
  const scouters = roomUtils.getCreepsByRole(room, "scouter")

  if (scouters.length === 0) {
    global.requestCreep(room, [MOVE], "scouter")
    return
  }

  const scouter = scouters[0]

  const centerPos = new RoomPosition(25, 25, targetRoomName)

  creepUtils.moveCreep(scouter, { pos: centerPos, range: 20 })
}

if (config.test.profiler) {
  manageScout = screepsProfiler.registerFN(manageScout, "manageScout")
}

module.exports = manageScout
