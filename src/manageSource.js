const config = require("./config")
const constant = require("./constant")
const coordUtils = require("./coordUtils")
const creepUtils = require("./creepUtils")
const mapUtils = require("./mapUtils")
const missionDefenseRemote = require("./missionDefenseRemote")
const pathUtils = require("./pathUtils")
const profiler = require("./profiler")
const roomUtils = require("./roomUtils")
const screepsProfiler = require("./screeps-profiler")
const spawnUtils = require("./spawnUtils")
const basePlanner = require("./util_base_planner")
const { colors } = require("./util_roomVisual_prototype")
const utils = require("./utils")

const CONTAINER_REPAIR_LOSS_OWNED = (REPAIR_COST * CONTAINER_DECAY) / CONTAINER_DECAY_TIME_OWNED

const CONTAINER_REPAIR_LOSS = (REPAIR_COST * CONTAINER_DECAY) / CONTAINER_DECAY_TIME

const ENERGY_AMOUNT_TO_PICK_UP = 50

const KEEPER_KILLER_COST = 4270 // keeperKiller cost

const RESERVER_ENERGY_COST = BODYPART_COST[CLAIM] + BODYPART_COST[MOVE]

const REMOTE_BUILDER_ENERGY_COST = 750

const RESERVE_POWER_MAX = 3

const REMOTE_BUILDER_BODY = [WORK, WORK, WORK, CARRY, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE]

const options = { align: "left", color: colors.cyan }

/**
 *
 * @param {Room} room
 */
let manageSource = function (room) {
  // get source infos
  let carryPower = 0

  const activeSources = getActiveSources(room)

  const activeSourceIds = activeSources.sourceIds

  let y = 3

  room.visual.rect(2.5, y - 1, 17, 5, { fill: colors.dark })

  room.visual.text(`${room.name}`, 9, y, options)

  y++

  room.visual.line(2.5, y - 0.25, 19.5, y - 0.25, { lineStyle: "dashed", opacity: 0.5, color: colors.gray })
  y++

  room.visual.text(`active sources: ${activeSourceIds.length}`, 3, y, options)
  room.visual.text(
    `hauler capacity: ${room.memory.haulerCarry || 0}/${Math.ceil(room.memory.haulerCarryTotal || 0)}`,
    9,
    y,
    options,
  )

  y++

  room.visual.text(`income: ${(room.memory.income || 0).toFixed(2)}`, 3, y, options)
  room.visual.text(`maxIncome: ${(room.memory.maxIncome || 0).toFixed(2)}`, 9, y, options)

  y += 2

  const sourceInfos = {}

  const remoteCheck = {}

  // gather and reset source stats
  for (const sourceId of activeSourceIds) {
    const info = Memory.sourceInfos[sourceId]

    const remoteInfo = room.memory.remotes[info.roomName]

    info.harvestPower = 0
    info.numMiner = 0
    info.energy = 0
    info.regeneration = ENERGY_REGEN_TIME
    info.pendingEnergy = 0

    sourceInfos[sourceId] = info

    if (remoteCheck[info.roomName] || info.my) {
      continue
    }

    remoteCheck[info.roomName] = true

    const remoteRoom = Game.rooms[info.roomName]

    if (remoteRoom && remoteRoom.memory.danger) {
      missionDefenseRemote.createMission(room, remoteRoom)
    }

    if (remoteInfo.type === constant.ROOM_TYPE_NORMAL) {
      remoteInfo.reservePower = 0
      remoteInfo.numReserver = 0
    } else if (remoteInfo.type === constant.ROOM_TYPE_KEEPER) {
      if (roomUtils.isStronghold(info.roomName)) {
        room.memory.activeSources = undefined
      }

      remoteInfo.spawnKeeperKiller = true
    }
  }

  const fadingSourceInfos = {}

  // check and run miners
  roomUtils.getCreepsByRole(room, "miner").forEach((creep) => {
    const sourceId = creep.memory.sourceId

    let info = sourceInfos[sourceId] || fadingSourceInfos[sourceId]

    if (!info) {
      info = Memory.sourceInfos[sourceId]

      if (!info) {
        return
      }

      info.energy = 0
      info.regeneration = ENERGY_REGEN_TIME
      info.pendingEnergy = 0

      fadingSourceInfos[sourceId] = info
    }

    runMiner(room, creep, info)

    if ((creep.ticksToLive || CREEP_LIFE_TIME) > creep.body.length * CREEP_SPAWN_TIME + info.distance) {
      info.harvestPower += creep.getActiveBodyparts(WORK) * HARVEST_POWER
      info.numMiner++
    }
  })

  // check and run hauler

  const idlers = []

  roomUtils.getCreepsByRole(room, "hauler").forEach((creep) => {
    if ((creep.ticksToLive || CREEP_LIFE_TIME) >= creep.body.length * CREEP_SPAWN_TIME) {
      carryPower += creep.getActiveBodyparts(CARRY) * CARRY_CAPACITY
    }

    if (creep.spawning) {
      return
    }

    runHaulerPretick(creep)

    if (creep.memory.supplying) {
      runHauler(room, creep)
      return
    }

    if (creep.memory.sourceId) {
      const info = Memory.sourceInfos[creep.memory.sourceId]
      // if there is no info, get back to main room
      if (!info) {
        runHaulerPretick(creep, true)
        runHauler(room, creep)
        return
      }

      if (mapUtils.getDanger(info.roomName)) {
        runHaulerPretick(creep, true)
        runHauler(room, creep)
        return
      }

      // if got the resources, get back to main room
      if (runHauler(room, creep) === OK) {
        runHaulerPretick(creep, true)
        runHauler(room, creep)
      }

      info.pendingEnergy -= creep.store.getFreeCapacity()
      return
    }

    idlers.push(creep)
  })

  // match idling haulers

  if (idlers.length > 0) {
    const mergedInfos = { ...sourceInfos, ...fadingSourceInfos }

    for (const sourceId in mergedInfos) {
      const info = mergedInfos[sourceId]

      const source = Game.getObjectById(sourceId)

      if (source) {
        info.energy = source.energy
        info.regeneration = source.ticksToRegeneration || ENERGY_REGEN_TIME
        info.pendingEnergy += getSourcePendingEnergy(source, info.type)

        if (info.constructing) {
          info.pendingEnergy -= 500
        }
      }
    }

    for (const creep of idlers) {
      if (matchHauler(mergedInfos, creep) == OK) {
        runHauler(room, creep)
        mergedInfos[creep.memory.sourceId].pendingEnergy -= creep.store.getFreeCapacity()
      }
    }
  }

  // check and run reservers

  roomUtils.getCreepsByRole(room, "reserver").forEach((creep) => {
    runReserver(room, creep)

    if ((creep.ticksToLive || CREEP_CLAIM_LIFE_TIME) < creep.body.length * CREEP_SPAWN_TIME + 100) {
      return
    }

    const remoteInfo = room.memory.remotes[creep.memory.targetRoomName]

    remoteInfo.reservePower += creep.getActiveBodyparts(CLAIM)
    remoteInfo.numReserver++
  })

  roomUtils.getCreepsByRole(room, "keeperKiller").forEach((creep) => {
    runKeeperKiller(creep)

    if ((creep.ticksToLive || CREEP_LIFE_TIME) < creep.body.length * CREEP_SPAWN_TIME + 100) {
      return
    }

    const remoteInfo = room.memory.remotes[creep.memory.targetRoomName]

    remoteInfo.spawnKeeperKiller = false
  })

  room.memory.enoughRoad = false

  // check and run construct

  room.memory.constructingIncome = 0
  constructRemotes(room, sourceInfos)

  repairRemotes(room, sourceInfos)

  // check creeps and request if needed
  if (room.memory.canSpawn) {
    room.memory.income = room.memory.defaultIncome || 0
    manageCreepList(room, sourceInfos, carryPower)
  }
}

/**
 *
 * @param {Creep} creep
 */
function runKeeperKiller(creep) {
  if (creep.spawning) {
    return
  }

  const roomName = creep.memory.targetRoomName

  if (creep.hits < creep.hitsMax) {
    creep.heal(creep)
  }

  const room = Game.rooms[roomName]

  if (!room || creep.room.name !== roomName) {
    creepUtils.moveCreep(creep, { pos: new RoomPosition(25, 25, roomName), range: 24 })
    return
  }

  if (!creep.memory.resourceIds) {
    return
  }

  const targetResources = creep.memory.resourceIds.map((id) => Game.getObjectById(id))

  const keepers = room.find(FIND_HOSTILE_CREEPS).filter((creep) => {
    if (creep.owner.username !== "Source Keeper") {
      return false
    }
    if (creep.pos.findInRange(targetResources, 5).length === 0) {
      return false
    }
    return true
  })

  if (keepers.length === 0) {
    const nextWaitingPos = getNextWaitingPos(creep, targetResources)
    if (nextWaitingPos) {
      creepUtils.moveCreep(creep, { pos: nextWaitingPos, range: 0 })
    }
    return
  } else {
    delete creep.heap.nextWaitingPos
  }

  const closeKeeper = keepers.find((sourceKeeper) => creep.pos.getRangeTo(sourceKeeper) <= 1)
  if (closeKeeper) {
    creep.move(creep.pos.getDirectionTo(closeKeeper))
    creep.cancelOrder("heal")
    creep.attack(closeKeeper)
    return
  }

  const goals = keepers.map((sourceKeeper) => {
    return { pos: sourceKeeper.pos, range: 1 }
  })

  creepUtils.moveCreep(creep, goals)
  return
}

function getNextWaitingPos(creep, targetResources) {
  if (!creep.heap.nextWaitingPos) {
    const nextWaitingPos = findNextKeeperLairStandingPos(creep.room.name, targetResources)
    creep.heap.nextWaitingPos = nextWaitingPos
  }
  return creep.heap.nextWaitingPos
}

function findNextKeeperLairStandingPos(roomName, targetResources) {
  const room = Game.rooms[roomName]

  if (!room) {
    return undefined
  }

  const structures = room.find(FIND_HOSTILE_STRUCTURES)

  let targetLair = undefined
  let ticksToSpawnMin = Infinity
  let targetResource

  const terrain = Game.map.getRoomTerrain(roomName)

  for (const structure of structures) {
    if (structure.structureType !== STRUCTURE_KEEPER_LAIR) {
      continue
    }

    const closeTargetResource = targetResources.find((resource) => resource.pos.getRangeTo(structure) < 6)

    if (!closeTargetResource) {
      continue
    }

    const ticksToSpawn = structure.ticksToSpawn

    if (ticksToSpawn === undefined) {
      continue
    }

    if (ticksToSpawn < ticksToSpawnMin) {
      targetLair = structure
      targetResource = closeTargetResource
      ticksToSpawnMin = ticksToSpawn
    }
  }

  if (!targetLair) {
    return
  }

  let closestCoord
  let closestRange = Infinity

  coordUtils.getCoordsAtRange(targetLair.pos, 1).forEach((coord) => {
    if (terrain.get(coord.x, coord.y) === TERRAIN_MASK_WALL) {
      return
    }

    const range = coordUtils.getRange(targetResource.pos, coord)

    if (range < closestRange) {
      closestCoord = coord
      closestRange = range
    }
  })

  if (!closestCoord) {
    return
  }

  return new RoomPosition(closestCoord.x, closestCoord.y, roomName)
}

/**
 *
 * @param {Creep} creep
 * @returns
 */
function avoidKeepers(creep) {
  const type = mapUtils.getRoomType(creep.room.name)

  if (type !== constant.ROOM_TYPE_KEEPER) {
    return constant.RETURN_COMPLETE
  }

  const keepers = roomUtils.findSourceKeepers(creep.room).filter((keeper) => creep.pos.getRangeTo(keeper) <= 5)

  if (!creep.memory.keeperIds && keepers.length > 0) {
    creep.memory.keeperIds = keepers.map((keeper) => keeper.id)
  } else if (
    creep.memory.keeperIds &&
    keepers.length === 0 &&
    !creep.memory.keeperIds.some((keeperId) => Game.getObjectById(keeperId))
  ) {
    creep.memory.keeperIds = undefined
  }

  if (keepers.length > 0) {
    const goals = keepers.map((keeper) => {
      return { pos: keeper.pos, range: 6 }
    })

    creepUtils.moveCreep(creep, goals, { flee: true, maxRooms: 1 })
    return constant.RETURN_ONGOING
  }

  const keeperLairs = creep.room.find(FIND_HOSTILE_STRUCTURES).filter((structure) => {
    if (structure.structureType !== STRUCTURE_KEEPER_LAIR) {
      return false
    }

    if (creep.pos.getRangeTo(structure) > 6) {
      return false
    }

    if (!structure.ticksToSpawn) {
      return false
    }

    if (structure.ticksToSpawn > 15) {
      return false
    }

    return true
  })

  if (!creep.memory.keeperLairIds && keeperLairs.length > 0) {
    creep.memory.keeperLairIds = keeperLairs.map((keeper) => keeper.id)
  } else if (
    creep.memory.keeperLairIds &&
    keeperLairs.length === 0 &&
    !creep.memory.keeperLairIds.some((keeperId) => {
      const keeperLair = Game.getObjectById(keeperId)
      if (!keeperLair) {
        return false
      }
      if (!keeperLair.ticksToSpawn || keeperLair.ticksToSpawn > 15) {
        return false
      }
    })
  ) {
    creep.memory.keeperLairIds = undefined
  }

  if (keeperLairs.length > 0) {
    const goals = keeperLairs.map((keeper) => {
      return { pos: keeper.pos, range: 6 }
    })

    creepUtils.moveCreep(creep, goals, { flee: true, maxRooms: 1 })
    return constant.RETURN_ONGOING
  }

  if (creep.memory.keeperIds || creep.memory.keeperLairIds) {
    return constant.RETURN_ONGOING
  }

  return constant.RETURN_COMPLETE
}

function repairRemotes(room, sourceInfos) {
  if (!room.memory.repairRemotes && Math.random() < 0.01) {
    room.memory.sourceIdToRepair = getSourceIdToRepair(room, sourceInfos, config.economy.roadRepairThreshold)
    room.memory.repairRemotes = true
  }

  if (!room.memory.repairRemotes) {
    return
  }

  if (!room.memory.sourceIdToRepair) {
    room.memory.repairRemotes = undefined

    const sourceRepairers = roomUtils.getCreepsByRole(room, "sourceRepairer")
    sourceRepairers.forEach((creep) => {
      creepUtils.setIdler(creep)
    })

    return
  }

  const sourceId = room.memory.sourceIdToRepair

  const info = sourceInfos[sourceId]

  if (!info) {
    room.memory.sourceIdToRepair = undefined
    return
  }

  if (repairSource(room, sourceId, info) === OK) {
    room.memory.sourceIdToRepair = getSourceIdToRepair(room, sourceInfos, 0.9)
  }
}

function repairSource(room, sourceId) {
  const sourceRepairers = roomUtils.getCreepsByRole(room, "sourceRepairer")

  if (sourceRepairers.length === 0) {
    const idler = roomUtils.pullIdler(room, (creep) => {
      if (creep.getActiveBodyparts(WORK) === 0) {
        return false
      }

      if (creep.getActiveBodyparts(CARRY) === 0) {
        return false
      }

      return true
    })

    if (idler) {
      idler.memory.role = "sourceRepairer"
    } else {
      const body = spawnUtils.getBuilderBody(room.energyCapacityAvailable, 6)
      global.requestCreep(room, body, "sourceRepairer")
    }

    return
  }

  let result

  sourceRepairers.forEach((creep) => {
    if (runSourceRepairer(room, creep, sourceId) === OK) {
      result = OK
    }
  })

  return result
}

/**
 *
 * @param {Room} room
 * @param {Creep} creep
 * @returns
 */
function runSourceRepairer(room, creep, sourceId) {
  if (creep.spawning) {
    return
  }

  if (avoidKeepers(creep) !== constant.RETURN_COMPLETE) {
    return
  }

  const info = Memory.sourceInfos[sourceId]

  if (mapUtils.getDanger(info.roomName)) {
    const centerPos = new RoomPosition(25, 25, room.name)
    if (creep.pos.getRangeTo(centerPos) > 20) {
      creepUtils.moveCreep(creep, { pos: centerPos, range: 20 })
    }
    return
  }

  if (creep.memory.working && creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
    creep.memory.working = false
  } else if (
    !creep.memory.working &&
    creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0 &&
    creep.room.name === info.roomName
  ) {
    creep.memory.working = true
  }

  // working. start from source -> go to base, repairing things

  if (creep.memory.working) {
    if (creep.room.name === room.name) {
      creep.memory.working = false
      return OK
    }

    const structureToRepair = creep.pos
      .lookFor(LOOK_STRUCTURES)
      .find((structure) => structure.structureType === STRUCTURE_ROAD && structure.hits < structure.hitsMax)

    if (structureToRepair) {
      creep.repair(structureToRepair)
      return
    }

    const pathToSource = getRemotePath(room, sourceId)

    creepUtils.moveCreepByPath(creep, pathToSource, { reverse: true })

    return
  }

  // fetching. go to source -> fetch energy

  const source = Game.getObjectById(sourceId)

  if (!source || (!creep.memory.startFetch && creep.pos.getRangeTo(source) > 2)) {
    const pathToSource = getRemotePath(room, sourceId)

    creepUtils.moveCreepByPath(creep, pathToSource, { reverse: false })
    return
  }

  creep.memory.startFetch = true

  const energies = source.pos
    .findInRange(FIND_DROPPED_RESOURCES, 1)
    .filter((energy) => energy.amount > ENERGY_AMOUNT_TO_PICK_UP)

  if (energies.length > 0) {
    const energy = utils.getMaxObject(energies, (energy) => energy.amount)
    if (creep.pos.getRangeTo(energy) > 1) {
      creepUtils.moveCreep(creep, { pos: energy.pos, range: 1 })
      return
    }
    creep.pickup(energy)
    return
  }

  const container = getSourceContainer(info)

  if (container) {
    if (creep.pos.getRangeTo(container) > 1) {
      creepUtils.moveCreep(creep, { pos: container.pos, range: 1 })
      return
    }
    creep.withdraw(container, RESOURCE_ENERGY)
    return
  }
}

function getSourceIdToRepair(room, sourceInfos, threshold) {
  for (const sourceId in sourceInfos) {
    const info = sourceInfos[sourceId]

    if (info.my) {
      continue
    }

    if (!info.constructed) {
      continue
    }

    const roadCoords = info.roadCoords

    for (const roomName in roadCoords) {
      if (roomName === room.name) {
        continue
      }

      const currentRoom = Game.rooms[roomName]

      if (!currentRoom) {
        continue
      }

      const coordsPacked = roadCoords[roomName]

      for (const coordPacked of coordsPacked) {
        const coord = coordUtils.unpackCoord(coordPacked)

        if (coordUtils.isEdge(coord)) {
          continue
        }

        const road = currentRoom
          .lookForAt(LOOK_STRUCTURES, coord.x, coord.y)
          .find((structure) => structure.structureType === STRUCTURE_ROAD)

        if (!road || road.hits / road.hitsMax <= threshold) {
          return sourceId
        }
      }
    }
  }

  return undefined
}

function constructRemotes(room, sourceInfos) {
  if (room.energyCapacityAvailable < REMOTE_BUILDER_ENERGY_COST) {
    return
  }

  if (room.memory.remoteConstructed) {
    room.memory.enoughRoad = true
    return
  }

  let counter = 0

  const sourceIds = Object.keys(sourceInfos)

  const maxCounter = Math.ceil((sourceIds.length - 2) / 2)

  const sourceIdsToConstruct = []

  let totalDistance = 0

  let constructedDistance = 0

  for (const sourceId of sourceIds) {
    const info = sourceInfos[sourceId]

    totalDistance += info.distance

    if (info.constructed) {
      constructedDistance += info.distance
      continue
    }

    if (counter >= maxCounter) {
      continue
    }

    sourceIdsToConstruct.push(sourceId)
    counter++

    room.memory.constructingIncome += info.maxIncome
  }

  if (constructedDistance / totalDistance >= 1 / 3) {
    room.memory.enoughRoad = true
  }

  const sourceBuilders = roomUtils.getCreepsByRole(room, "sourceBuilder")

  if (sourceIdsToConstruct.length === 0) {
    for (const creep of sourceBuilders) {
      creepUtils.setIdler(creep)
    }

    room.memory.remoteConstructed = true
    room.memory.remoteConstructedTick = Game.time
    return
  }

  const sourceBuildersClassified = {}

  const idlers = []

  for (const creep of sourceBuilders) {
    const sourceId = creep.memory.sourceId

    if (!sourceId) {
      idlers.push(creep)
      continue
    }

    if (!sourceId || !sourceIdsToConstruct.includes(sourceId)) {
      creep.memory.sourceId = undefined
      creep.memory.idlingTick = 0
      idlers.push(creep)
      continue
    }

    sourceBuildersClassified[sourceId] = sourceBuildersClassified[sourceId] || []
    sourceBuildersClassified[sourceId].push(creep)
  }

  for (const sourceId of sourceIdsToConstruct) {
    const info = sourceInfos[sourceId]
    const builders = sourceBuildersClassified[sourceId] || []

    if (constructSource(room, sourceId, info, builders, idlers)) {
      info.constructed = true
      info.constructing = undefined
      info.roomNameConstructing = undefined
    }
  }

  for (const creep of idlers) {
    creep.memory.idlingTick = creep.memory.idlingTick || 0
    creep.memory.idlingTick++

    if (creep.memory.idlingTick >= 3) {
      creepUtils.setIdler(creep)
    }
  }
}

function constructSource(room, sourceId, info, builders, idlers) {
  const targetRoom = Game.rooms[info.roomName]

  if (!targetRoom) {
    return
  }

  if (!info.roomNameConstructing || Math.random() < 0.1) {
    let currentRoomName

    // check and create construction sites

    const path = getRemotePath(room, sourceId)

    let complete = true

    // check container

    const containerCoord = coordUtils.unpackCoord(info.containerCoord)

    if (
      targetRoom.lookForAt(LOOK_CONSTRUCTION_SITES, containerCoord.x, containerCoord.y).length > 0 ||
      targetRoom.createConstructionSite(containerCoord.x, containerCoord.y, STRUCTURE_CONTAINER) === OK
    ) {
      currentRoomName = currentRoomName || info.roomName
      complete = false
    }

    // check roads

    let counter = 0

    for (let i = 0; i < path.length; i++) {
      const pos = path[i]

      if (coordUtils.isEdge(pos) || !Game.rooms[pos.roomName]) {
        continue
      }

      if (pos.lookFor(LOOK_CONSTRUCTION_SITES).length > 0 || pos.createConstructionSite(STRUCTURE_ROAD) === OK) {
        complete = false
        counter++
      }

      if (counter >= 3) {
        break
      }
    }

    counter = 0

    for (let i = path.length - 1; i > -1; i--) {
      const pos = path[i]

      if (coordUtils.isEdge(pos) || !Game.rooms[pos.roomName]) {
        continue
      }

      if (pos.lookFor(LOOK_CONSTRUCTION_SITES).length > 0 || pos.createConstructionSite(STRUCTURE_ROAD) === OK) {
        currentRoomName = currentRoomName || pos.roomName
        complete = false
        counter++
      }

      if (counter >= 3) {
        break
      }
    }

    if (complete) {
      return true
    }

    info.roomNameConstructing = currentRoomName

    if (info.my) {
      return
    }

    info.constructing = true
  }

  if (info.my) {
    return
  }

  const numWork = creepUtils.getActiveBodypartsFromArray(builders, WORK)

  if (numWork < 6) {
    const candidate = idlers.pop()
    if (candidate) {
      candidate.memory.sourceId = sourceId
      candidate.memory.idlingTick = undefined
      builders.push(candidate)
    } else {
      const idler = roomUtils.pullIdler(room, (creep) => {
        if (creep.getActiveBodyparts(WORK) === 0) {
          return false
        }

        if (creep.getActiveBodyparts(CARRY) === 0) {
          return false
        }

        return true
      })

      if (idler) {
        idler.memory.role === "sourceBuilder"
      } else {
        const body = REMOTE_BUILDER_BODY
        global.requestCreep(room, body, "sourceBuilder")
      }
    }
  }

  builders.forEach((creep) => runSourceBuilder(room, creep, info.roomNameConstructing, sourceId, info))
}

function runSourceBuilder(room, creep, currentRoomName, sourceId) {
  if (creep.spawning) {
    return
  }

  if (avoidKeepers(creep) !== constant.RETURN_COMPLETE) {
    return
  }

  const info = Memory.sourceInfos[sourceId]

  if (info && mapUtils.getDanger(info.roomName)) {
    const centerPos = new RoomPosition(25, 25, room.name)
    if (creep.pos.getRangeTo(centerPos) > 20) {
      creepUtils.moveCreep(creep, { pos: centerPos, range: 20 })
    }
    return
  }

  if (creep.memory.working && creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
    creep.memory.working = false
  } else if (!creep.memory.working && creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
    creep.memory.working = true
    delete creep.heap.targetId
  }

  if (creep.memory.working) {
    if (!currentRoomName) {
      return
    }

    if (creep.room.name !== currentRoomName) {
      const centerPos = new RoomPosition(25, 25, currentRoomName)
      creepUtils.moveCreep(creep, { pos: centerPos, range: 24 })
      return
    }

    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
      return
    }

    let target = Game.getObjectById(creep.heap.targetId)

    if (!target || !!target.pos || target.pos.roomName !== creep.room.name) {
      const constructionSites = creep.room.find(FIND_MY_CONSTRUCTION_SITES)
      target = creep.pos.findClosestByRange(constructionSites)

      if (!target) {
        return
      }

      creep.heap.targetId = target.id
    }

    if (creep.pos.getRangeTo(target) > 3 || coordUtils.isEdge(creep.pos)) {
      creepUtils.moveCreep(creep, { pos: target.pos, range: 0 })
      return
    }

    creep.setWorkingArea(target.pos, 3)
    creep.build(target)
    return
  }

  const source = Game.getObjectById(sourceId)

  if (!source) {
    return
  }

  const energies = source.pos
    .findInRange(FIND_DROPPED_RESOURCES, 1)
    .filter((energy) => energy.amount > ENERGY_AMOUNT_TO_PICK_UP)

  if (energies.length > 0) {
    const energy = utils.getMaxObject(energies, (energy) => energy.amount)
    if (creep.pos.getRangeTo(energy) > 1) {
      creepUtils.moveCreep(creep, { pos: energy.pos, range: 1 })
      return
    }
    creep.pickup(energy)
    return
  }

  const containers = source.pos
    .findInRange(FIND_STRUCTURES, 1)
    .filter((structure) => structure.structureType === STRUCTURE_CONTAINER)

  if (containers.length > 0) {
    const container = utils.getMaxObject(containers, (container) => container.store.getUsedCapacity(RESOURCE_ENERGY))
    if (creep.pos.getRangeTo(container) > 1) {
      creepUtils.moveCreep(creep, { pos: container.pos, range: 1 })
      return
    }
    creep.withdraw(container, RESOURCE_ENERGY)
    return
  }
}

function getActiveSources(room) {
  const activeSources = room.memory.activeSources

  if (activeSources && Math.random() < 0.9) {
    return activeSources
  }

  const numSpawn = roomUtils.getStructuresByType(room, STRUCTURE_SPAWN).length

  const energyCapacityAvailable = room.energyCapacityAvailable

  const reserve = energyCapacityAvailable >= RESERVER_ENERGY_COST

  const constructed = energyCapacityAvailable > REMOTE_BUILDER_ENERGY_COST

  const rcl = room.controller.level

  const numRemotes = Object.keys(room.memory.remotes).length

  if (
    activeSources &&
    activeSources.numSpawn === numSpawn &&
    activeSources.reserve === reserve &&
    activeSources.constructed === constructed &&
    activeSources.rcl === rcl &&
    activeSources.numRemotes === numRemotes &&
    Game.time < activeSources.tick + CREEP_LIFE_TIME
  ) {
    return activeSources
  }

  console.log("regenerate active sources")

  const result = (room.memory.activeSources = {
    sourceIds: [],
    numSpawn,
    reserve,
    constructed,
    rcl,
    numRemotes,
    tick: Game.time,
  })

  room.memory.remoteConstructed = undefined

  if (numSpawn === 0) {
    return result
  }

  Memory.sourceInfos = Memory.sourceInfos || {}

  const spawnUsageMax = (numSpawn * CREEP_LIFE_TIME) / CREEP_SPAWN_TIME

  let spawnUsage = spawnUsageMax

  let maxIncome = 0

  // porters

  if (rcl >= 4) {
    spawnUsage -= numSpawn * 15 * 1.5
    maxIncome -= (numSpawn * 15 * (2 * BODYPART_COST[CARRY] + BODYPART_COST[MOVE])) / 2 / CREEP_LIFE_TIME
  }

  if (rcl === 4) {
    spawnUsage -= room.memory.controllerNumCarry * 1.5
    maxIncome -=
      (room.memory.controllerNumCarry * (2 * BODYPART_COST[CARRY] + BODYPART_COST[MOVE])) / 2 / CREEP_LIFE_TIME
  }

  room.memory.defaultIncome = maxIncome

  const sourceIds = []

  const sourceLinks = roomUtils.getSourceLinks(room)

  for (const source of room.find(FIND_SOURCES)) {
    sourceIds.push(source.id)

    Memory.sourceInfos[source.id] = Memory.sourceInfos[source.id] || generateSourceInfo(room, source)

    const info = Memory.sourceInfos[source.id]

    if (!info) {
      return result
    }

    const linked = !!sourceLinks[source.id]

    spawnUsage -= computeSourceSpawnUsage(info, { constructed, linked, rcl })

    info.maxIncome = computeSourceIncome(info, { constructed, linked })

    maxIncome += info.maxIncome
  }

  sourceIds.sort((a, b) => Memory.sourceInfos[a].distance - Memory.sourceInfos[b].distance)

  const remoteStats = []

  for (const [remoteName, remoteInfo] of Object.entries(room.memory.remotes)) {
    if (remoteInfo.type === constant.ROOM_TYPE_KEEPER && energyCapacityAvailable < KEEPER_KILLER_COST) {
      continue
    }

    if (roomUtils.isStronghold(remoteName)) {
      continue
    }

    let value = 0

    let weight = 0

    if (remoteInfo.type === constant.ROOM_TYPE_NORMAL) {
      if (reserve) {
        value -= (BODYPART_COST[CLAIM] + BODYPART_COST[MOVE]) / (CREEP_CLAIM_LIFE_TIME - 100)
        weight += 5
      }
    } else if (remoteInfo.type === constant.ROOM_TYPE_KEEPER) {
      value -= KEEPER_KILLER_COST / (CREEP_LIFE_TIME - 100)
      weight += MAX_CREEP_SIZE
    }

    const intermediates = new Set()

    const remoteSourceIds = remoteInfo.sourceIds.sort(
      (a, b) => Memory.sourceInfos[a].distance - Memory.sourceInfos[b].distance,
    )

    const currentSourceIds = []

    for (const sourceId of remoteSourceIds) {
      currentSourceIds.push(sourceId)

      const info = Memory.sourceInfos[sourceId]
      const netIncome = computeRemoteSourceIncome(info, { reserve, constructed })
      const spawnUsage = computeRemoteSourceSpawnUsage(info, { reserve, constructed })

      for (const roomName of info.intermediates || []) {
        intermediates.add(roomName)
      }

      value += netIncome
      weight += spawnUsage

      remoteStats.push({
        roomName: remoteName,
        intermediates: Array.from(intermediates),
        value,
        weight,
        sourceIds: [...currentSourceIds],
      })

      info.maxIncome = netIncome
      info.constructed = undefined
    }
  }

  const buffer = numSpawn * 20

  const spawnCapacityForRemotes = Math.floor(spawnUsage - buffer)

  const table = new Array(spawnCapacityForRemotes + 1).fill(0)

  const resultTable = new Array(spawnCapacityForRemotes + 1)
  for (let i = 0; i < resultTable.length; i++) {
    resultTable[i] = []
  }

  // DP starts
  for (const stat of remoteStats) {
    const remoteName = stat.roomName
    const v = stat.value
    const w = Math.ceil(stat.weight)

    const intermediateNames = stat.intermediates
    for (let j = spawnCapacityForRemotes; j > 0; j--) {
      if (j + w > spawnCapacityForRemotes || table[j] === 0) {
        continue
      }

      const resultRemoteNames = resultTable[j].map((stat) => stat.roomName)

      if (resultRemoteNames.includes(remoteName)) {
        continue
      }

      if (
        intermediateNames &&
        intermediateNames.some((intermediateName) => !resultRemoteNames.includes(intermediateName))
      ) {
        continue
      }

      if (table[j] + v > table[j + w]) {
        table[j + w] = table[j] + v
        resultTable[j + w] = [...resultTable[j], stat]
      }
    }

    if (intermediateNames && intermediateNames.length > 0) {
      continue
    }

    if (v > table[w]) {
      table[w] = v
      resultTable[w] = [...resultTable[0], stat]
    }
  }

  let bestValue = 0
  let bestWeight = 0
  let resultStats = []

  for (let i = 0; i < table.length; i++) {
    if (table[i] > bestValue) {
      bestValue = table[i]
      bestWeight = i
      resultStats = resultTable[i]
    }
  }

  resultStats.sort((a, b) => b.value / b.weight - a.value / a.weight)

  for (const stat of resultStats) {
    maxIncome += stat.value

    const roomName = stat.roomName
    const remoteInfo = room.memory.remotes[roomName]

    if (remoteInfo.type === constant.ROOM_TYPE_KEEPER) {
      remoteInfo.activeSourceIds = stat.sourceIds
    }

    sourceIds.push(...stat.sourceIds)
  }

  result.sourceIds = sourceIds

  const remainSpawnUsage = spawnCapacityForRemotes - bestWeight + buffer

  const spawnUsageRatio = (100 * (1 - remainSpawnUsage / spawnUsageMax)).toFixed(2)

  room.memory.maxIncome = maxIncome

  return result
}

/**
 *
 * @param {Creep} creep
 * @returns
 */
function runReserver(room, creep) {
  const targetRoomName = creep.memory.targetRoomName

  if (mapUtils.getDanger(targetRoomName)) {
    const centerPos = new RoomPosition(25, 25, room.name)
    if (creep.pos.getRangeTo(centerPos) > 20) {
      creepUtils.moveCreep(creep, { pos: centerPos, range: 20 })
    }
    return
  }

  const targetRoom = Game.rooms[targetRoomName]

  if (!targetRoom) {
    const centerPos = new RoomPosition(25, 25, targetRoomName)
    creepUtils.moveCreep(creep, { pos: centerPos, range: 24 })
    return
  }

  const controller = targetRoom.controller

  const goal = (() => {
    const terrain = Game.map.getRoomTerrain(controller.room.name)

    const targetCoord = coordUtils.getCoordsAtRange(controller.pos, 1).find((coord) => {
      if (terrain.get(coord.x, coord.y) === TERRAIN_MASK_WALL) {
        return false
      }

      const creeps = controller.room.lookForAt(LOOK_CREEPS, coord.x, coord.y)
      for (const occupyingCreep of creeps) {
        if (occupyingCreep.name === creep.name) {
          continue
        }

        if (
          occupyingCreep &&
          occupyingCreep.my &&
          occupyingCreep.memory.role === "reserver" &&
          creep.getActiveBodyparts(CLAIM) <= occupyingCreep.getActiveBodyparts(CLAIM)
        ) {
          return false
        }
      }
      return true
    })

    if (targetCoord) {
      return { pos: new RoomPosition(targetCoord.x, targetCoord.y, controller.room.name), range: 0 }
    } else {
      return { pos: controller.pos, range: 1 }
    }
  })()

  if (creep.pos.getRangeTo(goal.pos) > goal.range) {
    creepUtils.moveCreep(creep, goal)
    return
  }

  if (controller.reservation && controller.reservation.username !== constant.MY_NAME) {
    creep.attackController(controller)
    return
  }

  creep.reserveController(controller)
}

/**
 *
 * @param {Object} sourceInfos
 * @param {Creep} hauler
 * @returns
 */
function matchHauler(sourceInfos, hauler) {
  let targetId
  let distance = Infinity

  const capacity = hauler.store.getFreeCapacity(RESOURCE_ENERGY)

  for (const sourceId in sourceInfos) {
    const info = sourceInfos[sourceId]

    if (hauler.ticksToLive < 2 * info.distance + 30) {
      continue
    }

    const expectedEnergyDelta = getSourceExpectedEnergyDelta(info)

    const expectedEnergy = info.pendingEnergy + expectedEnergyDelta

    if (expectedEnergy < 0.5 * capacity) {
      continue
    }

    const currentDistance = info.distance

    if (currentDistance < distance) {
      targetId = sourceId
      distance = currentDistance
    }
  }

  if (targetId) {
    hauler.memory.sourceId = targetId
    sourceInfos[targetId].pendingEnergy -= capacity
    return OK
  }

  const emoji = hauler.ticksToLive < hauler.body.length * CREEP_SPAWN_TIME ? "💀" : "⏳"

  hauler.say(emoji, true)

  return ERR_NOT_FOUND
}

function getSourceExpectedEnergyDelta(info) {
  if (info.distance < info.regeneration) {
    return Math.min(info.energy, info.harvestPower * info.distance)
  }

  return (
    Math.min(info.energy, info.harvestPower * info.regeneration) +
    info.harvestPower * (info.distance - info.regeneration)
  )
}

function runHaulerPretick(creep, forceChange = false) {
  if (creep.memory.supplying && (forceChange || creep.store.getUsedCapacity() === 0)) {
    creep.memory.supplying = false
    creep.memory.startSupplying = false
    creep.memory.sourceId = undefined
    creep.memory.targetRoomName = undefined
    creep.memory.startFetch = false
  } else if (!creep.memory.supplying && (forceChange || creep.store.getFreeCapacity() === 0)) {
    creep.memory.supplying = true
    creep.memory.startSupplying = false
  }
}

/**
 *
 * @param {Creep} creep
 */
function runHauler(room, creep) {
  const info = Memory.sourceInfos[creep.memory.sourceId]

  if (avoidKeepers(creep) !== constant.RETURN_COMPLETE) {
    return
  }

  if (info && mapUtils.getDanger(info.roomName)) {
    const centerPos = new RoomPosition(25, 25, room.name)
    if (creep.pos.getRangeTo(centerPos) > 20) {
      creepUtils.moveCreep(creep, { pos: centerPos, range: 20 })
    }
    return
  }

  if (creep.memory.supplying) {
    if (creep.memory.startSupplying) {
      room.suppliers.push(creep)
      return
    }

    const storage = room.storage

    if (!storage) {
      const startPos = roomUtils.getStartPos(room)

      if (creep.pos.getRangeTo(startPos) > 10) {
        creepUtils.moveCreep(creep, { pos: startPos, range: 1 })
        return
      }

      room.suppliers.push(creep)
      creep.memory.startSupplying = true
      return
    }

    if (creep.room.name === room.name) {
      const structuresNear = room.lookForAtArea(
        LOOK_STRUCTURES,
        Math.max(0, creep.pos.y - 1),
        Math.max(0, creep.pos.x - 1),
        Math.min(creep.pos.y + 1, 49),
        Math.min(creep.pos.x + 1, 49),
        true,
      )

      const targetExtensionInfo = structuresNear.find(
        (info) =>
          [STRUCTURE_EXTENSION, STRUCTURE_TOWER, STRUCTURE_SPAWN].includes(info.structure.structureType) &&
          info.structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
      )

      if (targetExtensionInfo) {
        creep.transfer(targetExtensionInfo.structure, RESOURCE_ENERGY)
      }
    }

    if (creep.pos.getRangeTo(storage) > 1) {
      if (creep.memory.sourceId) {
        const path = getRemotePath(room, creep.memory.sourceId)
        creepUtils.moveCreepByPath(creep, path, { reverse: true })
        return
      }

      const startPos = roomUtils.getStartPos(room)

      if (creep.pos.getRangeTo(startPos) > 10) {
        creepUtils.moveCreep(creep, { pos: startPos, range: 1 })
        return
      }
    }

    creep.transfer(storage, RESOURCE_ENERGY)
    return
  }

  const source = Game.getObjectById(creep.memory.sourceId)

  if (source) {
    Game.map.visual.line(creep.pos, source.pos)
  }

  const type = mapUtils.getRoomType(creep.room.name)

  const rangeToSource = type === constant.ROOM_TYPE_KEEPER ? 5 : 3

  if (!source || (!creep.memory.startFetch && creep.pos.getRangeTo(source) > rangeToSource)) {
    const info = Memory.sourceInfos[creep.memory.sourceId]

    if (info.constructed) {
      const path = getRemotePath(room, creep.memory.sourceId)
      creepUtils.moveCreepByPath(creep, path, { reverse: false })
      return
    }

    let pos

    const path = getRemotePath(room, creep.memory.sourceId)
    pos = path[path.length - 1]

    creepUtils.moveCreep(creep, { pos, range: 1 })
    return
  }

  creep.memory.startFetch = true

  const isKeeper = type === constant.ROOM_TYPE_KEEPER

  const energyThreshold = isKeeper ? ENERGY_AMOUNT_TO_PICK_UP * 2 : ENERGY_AMOUNT_TO_PICK_UP

  const energies = source.pos
    .findInRange(FIND_DROPPED_RESOURCES, rangeToSource)
    .filter((energy) => energy.amount > energyThreshold)

  if (energies.length > 0) {
    const energy = utils.getMaxObject(energies, (energy) => energy.amount)
    if (creep.pos.getRangeTo(energy) > 1) {
      creepUtils.moveCreep(creep, { pos: energy.pos, range: 1 })
      return
    }

    if (creep.pickup(energy) === OK) {
      const capacity = creep.store.getFreeCapacity(RESOURCE_ENERGY)
      if (energy.amount >= capacity) {
        return OK
      }
    }
    return
  }

  if (isKeeper) {
    const tombstones = source.pos
      .findInRange(FIND_TOMBSTONES, rangeToSource)
      .filter((tombstone) => tombstone.store.getUsedCapacity(RESOURCE_ENERGY) > 0)

    if (tombstones.length > 0) {
      const tombstone = utils.getMaxObject(tombstones, (tombstone) => tombstone.store.getUsedCapacity(RESOURCE_ENERGY))

      if (creep.pos.getRangeTo(tombstone) > 1) {
        creepUtils.moveCreep(creep, { pos: tombstone.pos, range: 1 })
        return
      }
      creep.withdraw(tombstone, RESOURCE_ENERGY)
      return
    }
  }

  const container = getSourceContainer(info)

  if (container) {
    if (creep.pos.getRangeTo(container) > 1) {
      creepUtils.moveCreep(creep, { pos: container.pos, range: 1 })
      return
    }

    creep.withdraw(container, RESOURCE_ENERGY)

    const containerAmount = container.store.getUsedCapacity(RESOURCE_ENERGY)

    if (containerAmount >= creep.store.getFreeCapacity(RESOURCE_ENERGY)) {
      return OK
    }

    if (containerAmount > 0) {
      return
    }
  }

  creep.memory.supplying = true
  creep.memory.startSupplying = false
}

function getSourceContainer(info) {
  if (info.containerId) {
    const container = Game.getObjectById(info.containerId)

    if (container) {
      return container
    }
  }

  info.containerId = undefined

  const coord = coordUtils.unpackCoord(info.containerCoord)

  const roomName = info.roomName

  const room = Game.rooms[roomName]

  if (room) {
    const container = room
      .lookForAt(LOOK_STRUCTURES, coord.x, coord.y)
      .find((structure) => structure.structureType === STRUCTURE_CONTAINER)

    if (container) {
      info.containerId = container.id
      return container
    }
  }
}

function getSourcePendingEnergy(source, type) {
  if (source._pendingEnergy) {
    return source._pendingEnergy
  }

  const isKeeper = type === constant.ROOM_TYPE_KEEPER

  const range = isKeeper ? 5 : 1

  source._pendingEnergy = 0

  source.pos.findInRange(FIND_DROPPED_RESOURCES, range).forEach((resource) => {
    if (resource.resourceType !== RESOURCE_ENERGY) {
      return
    }
    source._pendingEnergy += resource.amount
  })

  if (isKeeper) {
    source.pos.findInRange(FIND_TOMBSTONES, 5).forEach((tombstone) => {
      source._pendingEnergy += tombstone.store.getUsedCapacity(RESOURCE_ENERGY)
    })
  }

  const containers = roomUtils.getStructuresByType(source.room, STRUCTURE_CONTAINER)

  const container = source.pos.findInRange(containers, 1)[0]

  if (container) {
    source._pendingEnergy += container.store.getUsedCapacity(RESOURCE_ENERGY)
  }

  return source._pendingEnergy
}

/**
 *
 * @param {Creep} creep
 */
function runMiner(room, creep, info) {
  if (creep.spawning) {
    return
  }

  if (avoidKeepers(creep) !== constant.RETURN_COMPLETE) {
    return
  }

  if (mapUtils.getDanger(info.roomName)) {
    const centerPos = new RoomPosition(25, 25, room.name)
    if (creep.pos.getRangeTo(centerPos) > 20) {
      if (creep.store.getUsedCapacity() > 0) {
        for (const resourceType in creep.store) {
          creep.drop(resourceType)
        }
      }
      creepUtils.moveCreep(creep, { pos: centerPos, range: 20 })
    }
    return
  }

  const source = Game.getObjectById(creep.memory.sourceId)

  if (creep.room.name !== info.roomName) {
    const path = getRemotePath(room, creep.memory.sourceId)

    if (!info.constructed) {
      const pos = path[path.length - 1]

      creepUtils.moveCreep(creep, { pos, range: 0 })

      return
    }

    creepUtils.moveCreepByPath(creep, path, { reverse: false })
    return
  }

  const range = creep.pos.getRangeTo(source)

  const container = getSourceContainer(info)

  if (!container) {
    if (range <= 1) {
      creep.harvest(source)
      return
    }

    if (range > 3 && !creep.memory.findPos) {
      const info = Memory.sourceInfos[creep.memory.sourceId]

      if (!info.constructed) {
        creepUtils.moveCreep(creep, { pos: source.pos, range: 1 })
        return
      }

      const path = getRemotePath(room, creep.memory.sourceId)
      creepUtils.moveCreepByPath(creep, path, { reverse: false })
      return
    }

    creep.memory.findPos = true

    // check coord to go
    const terrain = Game.map.getRoomTerrain(creep.room.name)

    const targetCoord = coordUtils.getCoordsAtRange(source.pos, 1).find((coord) => {
      if (terrain.get(coord.x, coord.y) === TERRAIN_MASK_WALL) {
        return false
      }

      if (pathUtils.getDefaultCostMatrix(room).get(coord.x, coord.y) === 255) {
        return false
      }

      const creeps = source.room.lookForAt(LOOK_CREEPS, coord.x, coord.y)
      for (const occupyingCreep of creeps) {
        if (occupyingCreep.name === creep.name) {
          continue
        }

        if (
          occupyingCreep &&
          occupyingCreep.my &&
          occupyingCreep.memory.role === "miner" &&
          creep.getActiveBodyparts(WORK) <= occupyingCreep.getActiveBodyparts(WORK)
        ) {
          return false
        }
      }
      return true
    })

    if (targetCoord) {
      const targetPos = new RoomPosition(targetCoord.x, targetCoord.y, source.room.name)
      creepUtils.moveCreep(creep, { pos: targetPos, range: 0 })
      return
    }

    return
  }

  const numWork = creep.getActiveBodyparts(WORK)

  if (creep.pos.isEqualTo(container.pos)) {
    if (container.hits < 150000 && creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
      creep.repair(container)
      return
    }

    if (container.store.getFreeCapacity(RESOURCE_ENERGY) < numWork * HARVEST_POWER) {
      if (container.hits < CONTAINER_HITS && creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        creep.repair(container)
        return
      }

      if (Math.ceil(source.energy / (numWork * HARVEST_POWER)) < (source.ticksToRegeneration || 0)) {
        return
      }
    }

    if (
      room.my &&
      room.controller.level >= 6 &&
      creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0 &&
      creep.store.getFreeCapacity(RESOURCE_ENERGY) < HARVEST_POWER * numWork
    ) {
      const sourceLink = getSourceLink(room, creep)
      if (sourceLink) {
        creep.transfer(sourceLink, RESOURCE_ENERGY)
      }
    }

    creep.harvest(source)
    return
  }

  if (range > 3 && !creep.memory.findPos) {
    const info = Memory.sourceInfos[creep.memory.sourceId]

    if (!info.constructed) {
      creepUtils.moveCreep(creep, { pos: source.pos, range: 1 })
      return
    }

    const path = getRemotePath(room, creep.memory.sourceId)
    creepUtils.moveCreepByPath(creep, path, { reverse: false })
    return
  }

  creep.memory.findPos = true

  const occupied = source.room.lookForAt(LOOK_CREEPS, container.pos.x, container.pos.y).some((occupying) => {
    if (occupying.name === creep.name) {
      return false
    }

    if (
      occupying &&
      occupying.my &&
      occupying.memory.role === creep.memory.role &&
      numWork <= occupying.getActiveBodyparts(WORK) &&
      creep.getActiveBodyparts(CARRY) <= occupying.getActiveBodyparts(CARRY)
    ) {
      return true
    }
  })

  if (!occupied) {
    creepUtils.moveCreep(creep, { pos: container.pos, range: 0 })
    return
  }

  if (range <= 1) {
    if (room.my && room.controller.level >= 6) {
      const sourceLink = roomUtils.getSourceLinks(room)[creep.memory.sourceId]
      if (
        sourceLink &&
        creep.pos.getRangeTo(sourceLink) <= 1 &&
        creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0 &&
        creep.store.getFreeCapacity(RESOURCE_ENERGY) < HARVEST_POWER * creep.getActiveBodyparts(WORK)
      ) {
        creep.transfer(sourceLink, RESOURCE_ENERGY)
      }
    }

    creep.harvest(source)
    return
  }

  const terrain = Game.map.getRoomTerrain(creep.room.name)

  const targetCoord = coordUtils.getCoordsAtRange(source.pos, 1).find((coord) => {
    if (terrain.get(coord.x, coord.y) === TERRAIN_MASK_WALL) {
      return false
    }

    if (pathUtils.getDefaultCostMatrix(room).get(coord.x, coord.y) === 255) {
      return false
    }

    const creeps = source.room.lookForAt(LOOK_CREEPS, coord.x, coord.y)
    for (const occupyingCreep of creeps) {
      if (occupyingCreep.name === creep.name) {
        continue
      }

      if (
        occupyingCreep &&
        occupyingCreep.my &&
        occupyingCreep.memory.role === "miner" &&
        creep.getActiveBodyparts(WORK) <= occupyingCreep.getActiveBodyparts(WORK)
      ) {
        return false
      }
    }
    return true
  })

  if (targetCoord) {
    const targetPos = new RoomPosition(targetCoord.x, targetCoord.y, source.room.name)

    creepUtils.moveCreep(creep, { pos: targetPos, range: 0 })
    return
  }
}

/**
 *
 * @param {Creep} creep
 */
function getSourceLink(room, creep) {
  if (creep.memory.sourceLinkId) {
    const link = Game.getObjectById(creep.memory.sourceLinkId)
    if (link) {
      return link
    }
  }

  const sourceLink = roomUtils.getSourceLinks(room)[creep.memory.sourceId]

  if (sourceLink) {
    creep.memory.sourceLinkId = sourceLink.id
    return sourceLink
  }
}

/**
 *
 * @param {Room} room
 * @param {[Creep]} miners
 * @param {[Creep]} haulers
 * @returns
 */
function manageCreepList(room, sourceInfos, carryPower) {
  let carryPowerLeft = carryPower

  let maxCarryPowerTotal = 0

  let requested = false

  const sourceIds = Object.keys(sourceInfos)

  const remoteCheck = {}

  const canSpawnReserver = room.energyCapacityAvailable >= RESERVER_ENERGY_COST

  for (const sourceId of sourceIds) {
    const info = sourceInfos[sourceId]

    let energyPerTick = info.energyPerTick

    const remoteInfo = room.memory.remotes[info.roomName]

    if (remoteInfo) {
      if (remoteInfo.type === constant.ROOM_TYPE_NORMAL) {
        if (!remoteCheck[info.roomName]) {
          remoteCheck[info.roomName] = true

          // check reserver
          if (canSpawnReserver) {
            room.memory.income -= (BODYPART_COST[CLAIM] + BODYPART_COST[MOVE]) / (CREEP_CLAIM_LIFE_TIME - 100)

            const reservationTick = getReservationTick(info.roomName)

            remoteInfo.spawnReserver =
              reservationTick <= config.economy.reservationTickThreshold &&
              remoteInfo.reservePower < RESERVE_POWER_MAX &&
              remoteInfo.numReserver < remoteInfo.controllerNumOpen

            remoteInfo.reserve = reservationTick > 0 || remoteInfo.reservePower > 0
          }
        }

        // if not reserving, lower the energy per tick
        if (!remoteInfo.reserve) {
          energyPerTick *= 0.5
        }
      } else if (!remoteCheck[info.roomName] && remoteInfo.type === constant.ROOM_TYPE_KEEPER) {
        remoteCheck[info.roomName] = true
        room.memory.income -= KEEPER_KILLER_COST / (CREEP_LIFE_TIME - 100)
      }
    }

    // miner

    info.maxHarvestPower = getMaxHarvestPower(energyPerTick, info.type, info.constructed)

    const minerRatio = utils.clamp(info.harvestPower / energyPerTick, 0, 1)

    // hauler

    let maxCarryPower = 0

    let netIncome

    const constructed = info.constructed

    if (info.my) {
      const linked = !!roomUtils.getSourceLinks(room)[sourceId]

      if (linked) {
        maxCarryPower = 0
      } else {
        maxCarryPower += 2 * info.distance * (energyPerTick - (constructed ? CONTAINER_REPAIR_LOSS_OWNED : 1))
      }

      netIncome = computeSourceIncome(info, { constructed, linked })
    } else {
      if (info.constructing) {
        maxCarryPower = 0
      } else {
        maxCarryPower += 2 * info.distance * (energyPerTick - (constructed ? CONTAINER_REPAIR_LOSS : 1))

        if (room.memory.enoughRoad && !constructed) {
          maxCarryPower *= 9 / 8
        }

        if (info.pendingEnergy >= 2000) {
          maxCarryPower += 500
        }
      }

      netIncome = computeRemoteSourceIncome(info, {
        reserve: remoteInfo.reserve,
        constructed,
      })
    }

    const haulerRatio = utils.clamp(carryPowerLeft / maxCarryPower, 0, 1)

    carryPowerLeft -= maxCarryPower

    maxCarryPowerTotal += maxCarryPower

    // income

    room.memory.income += info.constructing ? 0 : netIncome * Math.min(minerRatio, haulerRatio)

    // request

    if (requested) {
      continue
    }

    requested = requestSourceWorkers(room, info, sourceId, minerRatio, haulerRatio)
  }

  room.memory.haulerCarry = carryPower
  room.memory.haulerCarryTotal = maxCarryPowerTotal
}

function getReservationTick(roomName) {
  const targetRoom = Game.rooms[roomName]
  if (!targetRoom) {
    return 0
  }

  if (!targetRoom.controller) {
    return 0
  }

  if (!targetRoom.controller.reservation) {
    return 0
  }

  const reservation = targetRoom.controller.reservation

  const sign = reservation.username === constant.MY_NAME ? 1 : -1

  return reservation.ticksToEnd * sign
}

/**
 *
 * @param {Room} room
 * @param {object} info
 * @param {string} sourceId
 * @param {number} energyPerTick
 * @param {number} minerRatio
 * @param {number} haulerRatio
 * @returns
 */
function requestSourceWorkers(room, info, sourceId, minerRatio, haulerRatio) {
  const remoteInfo = room.memory.remotes[info.roomName]

  if (remoteInfo && remoteInfo.spawnReserver) {
    remoteInfo.spawnReserver = undefined
    const maxClaim = Math.min(
      RESERVE_POWER_MAX - remoteInfo.reservePower,
      Math.floor(room.energyCapacityAvailable / RESERVER_ENERGY_COST),
    )
    const body = []
    for (let i = 0; i < maxClaim; i++) {
      body.push(CLAIM, MOVE)
    }
    const memory = { role: "reserver", targetRoomName: info.roomName }
    global.requestCreep(room, body, "reserver", { memory })
    return true
  }

  if (remoteInfo && remoteInfo.spawnKeeperKiller) {
    const body = constant.KEEPER_KILLER_BODY
    const memory = { role: "keeperKiller", targetRoomName: info.roomName, resourceIds: remoteInfo.activeSourceIds }
    global.requestCreep(room, body, "keeperKiller", { memory })
  }

  if (minerRatio >= 1 && haulerRatio >= 1 && !info.constructing) {
    return false
  }

  const income = room.memory.income || 0

  const minerEnergyCapacity = Math.max(300, income > 0 ? room.energyCapacityAvailable : room.energyAvailable)

  const haulerEnergyCapacity = room.energyAvailable

  if (minerRatio === 0) {
    const maxWork = Math.ceil(info.maxHarvestPower / HARVEST_POWER)
    const body = spawnUtils.getMinerBody(minerEnergyCapacity, maxWork, true)
    const memory = { role: "miner", sourceId }
    global.requestCreep(room, body, "miner", { memory, urgent: info.my })
    return true
  }

  if (haulerRatio === 0) {
    const body = spawnUtils.getHaulerBody(haulerEnergyCapacity, room.memory.enoughRoad)
    global.requestCreep(room, body, "hauler", { urgent: info.my })
    return true
  }

  if (minerRatio < 1 && info.numMiner < info.numOpen) {
    const maxWork = Math.ceil(info.maxHarvestPower / HARVEST_POWER)
    const body = spawnUtils.getMinerBody(minerEnergyCapacity, maxWork, true)
    const memory = { role: "miner", sourceId }
    global.requestCreep(room, body, "miner", { memory, urgent: false })
    return true
  }

  if (haulerRatio < minerRatio) {
    const body = spawnUtils.getHaulerBody(haulerEnergyCapacity, room.memory.enoughRoad)
    global.requestCreep(room, body, "hauler", { urgent: false })
    return true
  }

  return false
}

/**
 *
 * @param {*} room
 * @param {*} sourceId
 * @returns {[RoomPosition]}
 */
function getRemotePath(room, sourceId) {
  if (room.heap.remotePath && room.heap.remotePath[sourceId]) {
    return room.heap.remotePath[sourceId]
  }

  room.heap.remotePath = room.heap.remotePath || {}

  const sourceInfo = Memory.sourceInfos[sourceId]

  const roadCoords = sourceInfo.roadCoords

  const path = []

  for (const roomName in roadCoords) {
    const coordsPacked = roadCoords[roomName]
    for (const coordPacked of coordsPacked) {
      const coord = coordUtils.unpackCoord(coordPacked)
      path.push(new RoomPosition(coord.x, coord.y, roomName))
    }
  }

  return (room.heap.remotePath[sourceId] = path)
}

/**
 *
 * @param {object} info
 * @param {object} options - {constructed, reserve}
 * @param {boolean} options.reserve
 * @param {boolean} options.constructed
 * @returns
 */
function computeRemoteSourceIncome(info, options = {}) {
  let income = info.energyPerTick

  if (info.type === constant.ROOM_TYPE_NORMAL) {
    if (!options.reserve) {
      income *= 0.5
    }
  }

  const maxHarvestPower = getMaxHarvestPower(income, info.type, options.constructed)

  const minerCost = (maxHarvestPower * (options.constructed ? 70 : 80)) / (CREEP_LIFE_TIME - info.distance)

  const haulerCost = (info.distance * income * 0.04 * (options.constructed ? 75 : 100)) / CREEP_LIFE_TIME

  const loss = options.constructed ? CONTAINER_REPAIR_LOSS : 1

  return income - minerCost - haulerCost - loss
}

/**
 *
 * @param {object} info
 * @param {object} options - {constructed, linked, rcl}
 * @param {boolean} options.reserve
 * @param {boolean} options.constructed
 * @param {number} options.rcl
 * @returns
 */
function computeRemoteSourceSpawnUsage(info, options = {}) {
  let energyPerTick = info.energyPerTick

  if (info.type === constant.ROOM_TYPE_NORMAL) {
    if (!options.reserve) {
      energyPerTick *= 0.5
    }
  }

  const maxHarvestPower = getMaxHarvestPower(energyPerTick, info.type, options.constructed)

  const maxWork = Math.ceil(maxHarvestPower / HARVEST_POWER)

  const minerBody = spawnUtils.getMinerBody(10000, maxWork)

  const haulerUsage = energyPerTick * info.distance * 0.04 * (options.constructed ? 1.5 : 2)

  let result = minerBody.length + haulerUsage

  if (!options.rcl || options.rcl < 8) {
    const netIncome = computeRemoteSourceIncome(info, options)
    result += netIncome * 1.4
  }

  return result
}

function getMaxHarvestPower(energyPerTick, type, constructed) {
  return energyPerTick + (type === constant.ROOM_TYPE_KEEPER ? 6 : constructed ? 1 : 0)
}

/**
 *
 * @param {Room} room
 * @param {Source} source
 * @returns {object} {path, distance, numOpen, netIncome}
 */
function generateSourceInfo(room, source) {
  const basePlan = basePlanner.getBasePlan(room.name)

  if (!basePlan) {
    return
  }

  const info = {}

  const terrain = Game.map.getRoomTerrain(room.name)

  info.roomName = room.name

  info.my = true

  const startPos = new RoomPosition(basePlan.startCoord.x, basePlan.startCoord.y, room.name)

  const containerCoord = basePlan.containers[source.id]

  const containerPos = new RoomPosition(containerCoord.x, containerCoord.y, room.name)

  // from storage/spawn to source
  const path = findSourcePath(startPos, containerPos, basePlan)

  if (!path) {
    return
  }

  info.distance = path.length

  info.energyPerTick = SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME

  info.numOpen = coordUtils.getCoordsAtRange(source.pos, 1).filter((coord) => {
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

  info.containerCoord = coordUtils.packCoord(containerCoord)

  // road coords

  info.roadCoords = {}

  for (const pos of path) {
    const roomName = pos.roomName

    const packed = coordUtils.packCoord(pos)

    info.roadCoords[roomName] = info.roadCoords[roomName] || []

    info.roadCoords[roomName].push(packed)
  }

  return info
}

/**
 *
 * @param {object} info
 * @param {object} options - {constructed, linked}
 * @param {boolean} options.constructed
 * @param {boolean} options.linked
 */
function computeSourceIncome(info, options = {}) {
  const energyPerTick = info.energyPerTick

  const minerCost = 800 / (CREEP_LIFE_TIME - info.distance) // 6w3c1m or 5w5m1c

  const haulerCost = options.linked
    ? 0
    : (energyPerTick * info.distance * 0.04 * (options.constructed ? 75 : 100)) / CREEP_LIFE_TIME

  const loss = options.constructed ? CONTAINER_REPAIR_LOSS_OWNED : 1

  return energyPerTick - minerCost - haulerCost - loss
}

/**
 *
 * @param {object} info
 * @param {object} options - {constructed, linked, rcl}
 * @param {boolean} options.constructed
 * @param {boolean} options.linked
 * @param {number} options.rcl
 */
function computeSourceSpawnUsage(info, options) {
  let result = 0

  result += 12 // miner

  result += info.linked
    ? 0
    : info.distance *
      0.04 *
      (info.energyPerTick - (options.constructed ? CONTAINER_REPAIR_LOSS_OWNED : 1)) *
      (options.constructed ? 1.5 : 2) // hauler

  if (!options.rcl || options.rcl < 8) {
    const netIncome = computeSourceIncome(info, options)
    result += netIncome * 1.4 // upgrader
  }

  return result
}

function findSourcePath(startPos, containerPos, basePlan) {
  const search = PathFinder.search(
    startPos,
    { pos: containerPos, range: 1 },
    {
      plainCost: 255,
      swampCost: 255,
      maxOps: 20000,
      heuristicWeight: 1,
      roomCallback: function () {
        const costs = new PathFinder.CostMatrix()

        for (let i = 1; i <= 8; i++) {
          for (const unpacked of basePlan.structures[i]) {
            if (unpacked.structureType === STRUCTURE_ROAD) {
              costs.set(unpacked.coord.x, unpacked.coord.y, 1)
              continue
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

if (config.test.profiler) {
  manageSource = screepsProfiler.registerFN(manageSource, "manageSource")
  runHauler = screepsProfiler.registerFN(runHauler, "runHauler")
  runMiner = screepsProfiler.registerFN(runMiner, "runMiner")
  matchHauler = screepsProfiler.registerFN(matchHauler, "matchHauler")
  getSourcePendingEnergy = screepsProfiler.registerFN(getSourcePendingEnergy, "getSourcePendingEnergy")
  getRemotePath = screepsProfiler.registerFN(getRemotePath, "getRemotePath")
}

module.exports = manageSource
