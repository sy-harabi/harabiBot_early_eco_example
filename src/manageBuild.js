const config = require("./config")
const constant = require("./constant")
const creepUtils = require("./creepUtils")
const roomUtils = require("./roomUtils")
const screepsProfiler = require("./screeps-profiler")
const spawnUtils = require("./spawnUtils")

let manageBuild = function (room, builders) {
  const constructionSites = room.find(FIND_MY_CONSTRUCTION_SITES)

  const ramparts = roomUtils
    .getStructuresByType(room, STRUCTURE_RAMPART)
    .filter((rampart) => rampart.hits < config.economy.rampartHitsMin / 2)

  if (room.memory.building && constructionSites.length === 0 && ramparts.length === 0) {
    room.memory.building = false
    room.memory.buildPower = undefined
    for (const creep of builders) {
      creepUtils.setIdler(creep)
    }
  } else if (!room.memory.building && (constructionSites.length > 0 || ramparts.length > 0)) {
    room.memory.building = true
  }

  if (!room.memory.building) {
    return
  }

  const energyDepot =
    room.storage ||
    roomUtils.getControllerLinkPos(room).lookFor(LOOK_RESOURCES)[0] ||
    roomUtils.getControllerContainer(room)

  const isResource = energyDepot instanceof Resource

  const priorityTargets = getPriorityTargets(constructionSites, ramparts, energyDepot)

  if (priorityTargets) {
    for (const creep of builders) {
      runBuilder(room, creep, energyDepot, priorityTargets, isResource)
    }
  }

  if (!room.memory.canSpawn) {
    return
  }

  room.memory.buildPower = 0

  for (const creep of builders) {
    if ((creep.ticksToLive || CREEP_LIFE_TIME) > creep.body.length * CREEP_SPAWN_TIME) {
      const buildPower = creep.getActiveBodyparts(WORK) * 5
      room.memory.numWork += buildPower
      room.memory.buildPower += buildPower
    }
  }

  if (room.memory.numWork < room.memory.maxWork || room.memory.buildPower === 0) {
    let urgent
    if (room.storage) {
      urgent = urgent || roomUtils.getEnergyLevel(room) >= config.economy.energyLevel.workerFirst
    } else {
      urgent = urgent || room.memory.spawnBalance > 0.5
    }

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
      idler.memory.role = "builder"
    } else {
      const body = spawnUtils.getBuilderBody(room.energyCapacityAvailable)
      global.requestCreep(room, body, "builder", { urgent })
    }
  }
}

/**
 *
 * @param {Room1} room
 * @param {Creep} creep
 * @param {*} energyDepot
 * @param {*} target
 * @returns
 */
function runBuilder(room, creep, energyDepot, priorityTargets, isResource) {
  if (creep.spawning) {
    return
  }

  let target

  if (creep.memory.targetId) {
    target = Game.getObjectById(creep.memory.targetId)
  }

  if (!target) {
    target = creep.pos.findClosestByRange(priorityTargets)
    if (!target) {
      if (creep.room.name !== room.name) {
        creepUtils.moveCreep(creep, { pos: roomUtils.getStartPos(room), range: 5 })
      }
      return
    }
    creep.memory.targetId = target.id
  }

  if (!room.storage) {
    creep.useRate = 5
    room.creepsToFill.push(creep)
  }

  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
    if (!energyDepot) {
      roomUtils.subtractSpawnBalance(room)

      if (creep.pos.getRangeTo(target) > 3) {
        creepUtils.moveCreep(creep, { pos: target.pos, range: 3 })
      }

      return
    }

    if (creep.pos.getRangeTo(energyDepot) > 3) {
      creepUtils.moveCreep(creep, { pos: energyDepot.pos, range: 1 })
      return
    }

    if (!isResource && energyDepot.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
      roomUtils.subtractSpawnBalance(room)
      return
    }

    if (creep.pos.getRangeTo(energyDepot) > 1) {
      creepUtils.moveCreep(creep, { pos: energyDepot.pos, range: 1 })
      return
    }

    if (isResource) {
      if (creep.pickup(energyDepot) === OK) {
        creep.memory.targetId = undefined
      }
    } else if (creep.withdraw(energyDepot, RESOURCE_ENERGY) === OK) {
      creep.memory.targetId = undefined
    }
  }

  if (creep.pos.getRangeTo(target) > 3) {
    creepUtils.moveCreep(creep, { pos: target.pos, range: 3 })
    return
  }

  if (target instanceof StructureRampart) {
    creep.repair(target)
    if (target.hits > config.economy.rampartHitsMin) {
      creep.memory.targetId = undefined
    }
  } else {
    creep.build(target)
  }

  creep.setWorkingArea(target.pos, 3)

  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    return
  }
}

function getPriorityTargets(constructionSites, ramparts, energyDepot) {
  let targets = []
  let currentPriority = Infinity

  if (energyDepot && ramparts.length > 0) {
    return ramparts
  }

  for (const constructionSite of constructionSites) {
    if (OBSTACLE_OBJECT_TYPES.includes(constructionSite.structureType)) {
      const creepOnConstructionSite = constructionSite.pos.lookFor(LOOK_CREEPS).find((creep) => creep.my)
      if (creepOnConstructionSite) {
        creepOnConstructionSite.move(Math.ceil(Math.random() * 8))
      }
    }

    const priority = constant.BUILD_PRIORITY[constructionSite.structureType]

    if (priority > currentPriority) {
      continue
    }

    if (priority < currentPriority) {
      currentPriority = priority
      targets = [constructionSite]
      continue
    }

    if (priority === currentPriority) {
      targets.push(constructionSite)
      continue
    }
  }

  return targets
}

if (config.test.profiler) {
  manageBuild = screepsProfiler.registerFN(manageBuild, "manageBuild")
}

module.exports = manageBuild
