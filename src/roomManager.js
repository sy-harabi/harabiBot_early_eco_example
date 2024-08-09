const config = require("./config")
const constant = require("./constant")
const coordUtils = require("./coordUtils")
const creepUtils = require("./creepUtils")
const dataStorage = require("./dataStorage")
let manageBuild = require("./manageBuild")
let manageDefense = require("./manageDefense")
const manageHub = require("./manageHub")
let manageLogistics = require("./manageLogistics")
let manageScout = require("./manageScout")
let manageSource = require("./manageSource")
let manageUpgrade = require("./manageUpgrade")
const roomUtils = require("./roomUtils")
const screepsProfiler = require("./screeps-profiler")
const spawnUtils = require("./spawnUtils")
const basePlanner = require("./util_base_planner")
const { colors } = require("./util_roomVisual_prototype")
const utils = require("./utils")

RAMPART_FEE = (REPAIR_COST * RAMPART_DECAY_AMOUNT) / RAMPART_DECAY_TIME

const roomManager = {
  /**
   *
   * @param {[Room]} rooms
   */
  run(rooms) {
    for (const room of rooms) {
      if (room && room.my) {
        runMyRoom(room)
      }
    }

    if (Memory.visualizeBasePlan) {
      for (const roomName of Memory.myRooms) {
        basePlanner.visualizeBasePlan(roomName)
      }
    }
  },

  /**
   * functions to get all the owned rooms
   * @param {[Room]} rooms
   * @returns {[Room]}
   */
  preTick(rooms) {
    Memory.myRooms = []
    dataStorage.temp.myRooms = []

    for (const room of rooms) {
      updateEnemy(room)

      if (room.my) {
        Memory.myRooms.push(room.name)

        dataStorage.temp.myRooms.push(room)

        cacheCreeps(room)

        manageRclRecord(room)
      }

      room.memory.updateTick = Game.time
    }
  },
}

/**
 *
 * @param {Room} room
 */
function runMyRoom(room) {
  room.creepsToFill = []

  const upgraders = roomUtils.getCreepsByRole(room, "upgrader")

  const builders = roomUtils.getCreepsByRole(room, "builder")

  manageRamparts(room)

  manageUpgrade(room, upgraders, builders)

  manageBuild(room, builders)

  room.suppliers = []

  room.memory.remotes = room.memory.remotes || {}

  manageSource(room)

  manageLogistics(room, room.suppliers, room.creepsToFill)

  manageIdlers(room)

  manageHub(room)

  manageDefense(room)

  manageLink(room)

  manageConstruction(room)

  manageScout(room)
}

function manageIdlers(room) {
  const idlers = roomUtils.getCreepsByRole(room, "idler")
  for (const idler of idlers) {
    if (idler.memory.role) {
      continue
    }

    idler.say("🎧")
    if (idler.room.name !== room.name || coordUtils.isEdge(idler.pos)) {
      creepUtils.moveCreep(idler, { pos: roomUtils.getStartPos(room), range: 1 })
    }
  }
}

/**
 *
 * @param {Room} room
 */
function manageRamparts(room) {
  const ramaprts = roomUtils.getStructuresByType(room, STRUCTURE_RAMPART)

  const rampartRepairers = roomUtils.getCreepsByRole(room, "rampartRepairer")

  let numWork = 0
  let numCreep = 0

  rampartRepairers.forEach((creep) => {
    runRampartRepairer(room, creep, ramaprts)
    if ((creep.ticksToLive || CREEP_LIFE_TIME) > creep.body.length * CREEP_SPAWN_TIME) {
      numWork += creep.getActiveBodyparts(WORK)
      numCreep++
    }
  })

  room.memory.rampartRepairPower = numWork

  if (!room.memory.canSpawn) {
    return
  }

  const maxWork = getRampartRepairerMaxWork(room)

  if (numWork < maxWork) {
    let work

    if (numCreep < Math.ceil(maxWork / numWork)) {
      work = maxWork - numWork
    } else {
      work = maxWork
    }

    const body = spawnUtils.getBuilderBody(room.energyCapacityAvailable, work)
    global.requestCreep(room, body, "rampartRepairer")
  }
}

/**
 *
 * @param {Room} room
 */
function getRampartRepairerMaxWork(room) {
  const ramparts = roomUtils.getStructuresByType(room, STRUCTURE_RAMPART)

  if (ramparts.length === 0) {
    return 0
  }

  const lowestHits = Math.min(...ramparts.map((rampart) => rampart.hits))

  const maxHits = RAMPART_HITS_MAX[room.controller.level]

  if (lowestHits > 0.9 * maxHits) {
    return 0
  }

  const energyLevel = roomUtils.getEnergyLevel(room)

  if (energyLevel >= config.economy.energyLevel.rampartHigh) {
    return Math.ceil(utils.clamp(energyLevel - config.economy.energyLevel.rampartHigh, 10, 50))
  }

  if (energyLevel >= config.economy.energyLevel.rampart || lowestHits < 2 * config.economy.rampartHitsMin) {
    return 10
  }

  return 0
}

/**
 *
 * @param {Room} room
 * @param {Creep} creep
 * @returns
 */
function runRampartRepairer(room, creep, ramaprts) {
  if (creep.memory.working && creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
    creep.memory.working = false
    delete creep.memory.targetId
  } else if (!creep.memory.working && creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
    creep.memory.working = true
  }

  if (!creep.memory.working) {
    const energySource = room.storage || roomUtils.getControllerContainer(room)

    if (!energySource) {
      return
    }

    if (creep.pos.getRangeTo(energySource) > 1) {
      creepUtils.moveCreep(creep, { pos: energySource.pos, range: 1 })
      return
    }

    creep.withdraw(energySource, RESOURCE_ENERGY)
    return
  }

  let target = Game.getObjectById(creep.memory.targetId)

  if (!target) {
    target = utils.getMinObject(ramaprts, (rampart) => rampart.hits)

    if (!target) {
      return
    }

    creep.memory.targetId = target.id
  }

  if (creep.pos.getRangeTo(target) > 2) {
    creepUtils.moveCreep(creep, { pos: target.pos, range: 2 })
    return
  }

  creep.setWorkingArea(target.pos, 3)

  target = utils.getMinObject(creep.pos.findInRange(ramaprts, 3), (rampart) => rampart.hits)

  creep.repair(target)
}

function manageLink(room) {
  const storageLink = roomUtils.getStorageLink(room)

  if (!storageLink) {
    return
  }

  const controllerLink = roomUtils.getControllerLink(room)

  const sourceLinks = roomUtils.getSourceLinks(room)

  if (sourceLinks) {
    for (const sourceLink of Object.values(sourceLinks)) {
      if (
        controllerLink &&
        sourceLink.store.getUsedCapacity(RESOURCE_ENERGY) > 700 &&
        controllerLink.store.getFreeCapacity(RESOURCE_ENERGY) >= 400
      ) {
        sourceLink.transferEnergy(controllerLink)
        continue
      }

      if (
        storageLink &&
        sourceLink.store.getUsedCapacity(RESOURCE_ENERGY) > 700 &&
        storageLink.store.getFreeCapacity(RESOURCE_ENERGY) >= 400
      ) {
        sourceLink.transferEnergy(storageLink)
        continue
      }
    }
  }

  if (!controllerLink) {
    return
  }

  if (
    storageLink.store.getUsedCapacity(RESOURCE_ENERGY) > 700 &&
    controllerLink.store.getFreeCapacity(RESOURCE_ENERGY) > 400
  ) {
    storageLink.transferEnergy(controllerLink)
  }
}

/**
 *
 * @param {Room} room
 */
function cacheCreeps(room) {
  room.creeps = {}

  const creepNames = []

  for (const creepName of room.memory.creepNames || []) {
    const creep = Game.creeps[creepName]

    if (!creep) {
      dataStorage.clearCreepData(creepName)
      continue
    }

    creepNames.push(creepName)

    const role = creep.memory.role || "idler"

    room.creeps[role] = room.creeps[role] || []

    room.creeps[role].push(creep)
  }

  room.memory.creepNames = creepNames
}

/**
 *
 * @param {Room} room
 */
function manageRclRecord(room) {
  if (!room.memory.rcl) {
    room.memory.rcl = 1
    room.memory.startTick = Game.time
  }

  if (!room.memory.rclRecord) {
    room.memory.rclRecord = room.memory.rclRecord || {}
  }

  if (room.controller.level > room.memory.rcl) {
    room.memory.rclRecord[room.controller.level] = Game.time - room.memory.startTick
    room.memory.rcl = room.controller.level
  }

  if (room.memory.rclRecord && config.test.speedrun) {
    let x = 43.5
    let y = 3

    room.visual.rect(x - 0.5, y - 1, 6, room.memory.rcl + 0.5, { fill: colors.dark })

    const options = { color: colors.cyan, align: "left" }

    new RoomVisual(room.name).text(`Tick: ${Game.time - room.memory.startTick}`, x, y, options)

    y++

    for (let i = 0; i <= room.controller.level; i++) {
      const record = room.memory.rclRecord[i]

      if (!record) {
        continue
      }

      new RoomVisual(room.name).text(`RCL${i}: ${record}`, x, y, options)
      y++
    }
  }
}

function manageConstruction(room) {
  const rcl = room.controller.level

  room.memory.constructionLevel = room.memory.constructionLevel || rcl - 1

  // when get downgraded or enough time has passed, reset and check again.
  if (
    rcl < room.memory.constructionLevel ||
    !room.memory.lastConstructionTick ||
    Game.time > room.memory.lastConstructionTick + CREEP_LIFE_TIME
  ) {
    room.memory.constructionLevel = 0
  }

  // return when everything is fine
  if (rcl === room.memory.constructionLevel) {
    return
  }

  if (createConstructionSiteByBasePlan(room) === constant.RETURN_COMPLETE) {
    room.memory.constructionLevel = rcl
    room.memory.lastConstructionTick = Game.time
    return
  }
}

function createConstructionSiteByBasePlan(room) {
  // if room is not mine, stop.
  if (!room.my) {
    return constant.RETURN_ONGOING
  }

  let numConstructionSites = room.find(FIND_CONSTRUCTION_SITES).length

  // if there is more than one construction sites, stop.
  if (numConstructionSites > 1) {
    return constant.RETURN_ONGOING
  }

  // get base plan
  const basePlan = basePlanner.getBasePlan(room.name)

  const rcl = room.controller.level

  if (rcl < 5 && rcl > 1) {
    const coord = basePlan.links.controller
    room.createConstructionSite(coord.x, coord.y, STRUCTURE_CONTAINER)
  }

  for (let i = 1; i <= rcl; i++) {
    const structures = basePlan.structures[i]
    for (const unpacked of structures) {
      if (numConstructionSites > 10) {
        return constant.RETURN_ONGOING
      }

      const coord = unpacked.coord
      const structureType = unpacked.structureType

      const isConstructionSites = room.lookForAt(LOOK_CONSTRUCTION_SITES, coord.x, coord.y).length > 0

      if (isConstructionSites) {
        continue
      }

      const existingStructures = room.lookForAt(LOOK_STRUCTURES, coord.x, coord.y)

      const isStructure = !!existingStructures.find((structure) => structure.structureType === structureType)

      if (isStructure) {
        continue
      }

      if (structureType === STRUCTURE_LINK) {
        const container = existingStructures.find((structure) => structure.structureType === STRUCTURE_CONTAINER)
        if (container) {
          container.destroy()
          return
        }
      }

      const name = structureType === STRUCTURE_SPAWN ? basePlanner.packStructure(coord, structureType) : undefined
      if (room.createConstructionSite(coord.x, coord.y, structureType, name) === OK) {
        numConstructionSites++
      }
    }
  }

  return constant.RETURN_COMPLETE
}

/**
 *
 * @param {Room} room
 */
function updateEnemy(room) {
  const hostileCreeps = roomUtils.findHostileCreeps(room)

  if (hostileCreeps.length === 0 && (!room.memory.lastDanger || Game.time > room.memory.lastDanger + 5)) {
    room.memory.danger = false
    room.memory.lastDanger = undefined
    room.memory.enemyIntel = undefined
    return
  }

  let totalAttack = 0

  let totalRanged = 0

  let totalHeal = 0

  const creeps = []

  room.memory.danger = false
  room.memory.lastDanger = undefined

  for (const creep of hostileCreeps) {
    const name = creep.name
    const owner = creep.owner.username

    if (owner === constant.SOURCE_KEEPER_NAME) {
      continue
    }

    const coord = { x: creep.pos.x, y: creep.pos.y }
    const combatStat = creepUtils.getCombatStat(creep)
    const info = { name, owner, coord, ...combatStat }

    if (info.attack > 0 || info.ranged > 0) {
      room.memory.lastDanger = Game.time
      room.memory.danger = true
    }

    totalAttack += info.attack
    totalRanged += info.ranged
    totalHeal += info.heal

    creeps.push(info)
  }

  room.memory.enemyIntel = { totalAttack, totalRanged, totalHeal, creeps }
}

if (config.test.profiler) {
  screepsProfiler.registerObject(roomManager, "roomManager")
  runMyRoom = screepsProfiler.registerFN(runMyRoom, "runMyRoom")
  updateEnemy = screepsProfiler.registerFN(updateEnemy, "updateEnemy")
  manageConstruction = screepsProfiler.registerFN(manageConstruction, "manageConstruction")
  manageRclRecord = screepsProfiler.registerFN(manageRclRecord, "manageRclRecord")
  cacheCreeps = screepsProfiler.registerFN(cacheCreeps, "cacheCreeps")
  manageLink = screepsProfiler.registerFN(manageLink, "manageLink")
  runRampartRepairer = screepsProfiler.registerFN(runRampartRepairer, "runRampartRepairer")
  manageRamparts = screepsProfiler.registerFN(manageRamparts, "manageRamparts")
  manageIdlers = screepsProfiler.registerFN(manageIdlers, "manageIdlers")
}

module.exports = roomManager
