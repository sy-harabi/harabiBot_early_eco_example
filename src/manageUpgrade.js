const config = require("./config")
const coordUtils = require("./coordUtils")
const creepUtils = require("./creepUtils")
const pathUtils = require("./pathUtils")
const roomUtils = require("./roomUtils")
const screepsProfiler = require("./screeps-profiler")
const spawnUtils = require("./spawnUtils")
const utils = require("./utils")

/**
 *
 * @param {Room} room
 * @param {[Creep]} upgraders
 */
let manageUpgrade = function (room, upgraders) {
  const controller = room.controller

  new RoomVisual(room.name).text(
    `${room.memory.numWork || 0}/${room.memory.maxWork || 0}`,
    controller.pos.x + 1,
    controller.pos.y,
    {
      font: 0.5,
      align: "left",
    },
  )

  const energyDepot =
    roomUtils.getControllerLink(room) ||
    roomUtils.getControllerLinkPos(room).lookFor(LOOK_RESOURCES)[0] ||
    roomUtils.getControllerContainer(room)

  const isResource = energyDepot instanceof Resource

  const costs = pathUtils.getDefaultCostMatrix(room)

  const upgradeArea = getUpgradeArea(room)

  creepUtils.fillSpaceWithCreeps(upgradeArea, upgraders, costs)

  for (const creep of upgraders) {
    runUpgrader(room, creep, upgraders, controller, energyDepot, isResource)
  }

  if (!room.memory.canSpawn) {
    return
  }

  room.memory.numWork = 0
  let numCreep = 0

  for (const creep of upgraders) {
    if ((creep.ticksToLive || CREEP_LIFE_TIME) > creep.body.length * CREEP_SPAWN_TIME) {
      room.memory.numWork += creep.getActiveBodyparts(WORK)
      numCreep++
    }
  }

  const maxWork = getMaxWork(room)

  room.memory.maxWork = maxWork

  if (room.memory.building) {
    return
  }

  // controllerNumCarry
  room.memory.controllerNumCarry = Math.floor(getControllerMaxCarryPower(room) / 50)

  // spawn upgrader

  if (room.memory.numWork < maxWork) {
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
      idler.memory.role = "upgrader"
    } else {
      let work

      if (numCreep < Math.ceil(maxWork / room.memory.numWork)) {
        work = maxWork - room.memory.numWork
      } else {
        work = maxWork
      }

      let urgent

      if (room.storage) {
        urgent = roomUtils.getEnergyLevel(room) >= config.economy.energyLevel.workerFirst
      } else {
        urgent = room.memory.spawnBalance > 0.5
      }

      const body = spawnUtils.getUpgraderBody(room.energyCapacityAvailable, work)

      global.requestCreep(room, body, "upgrader", { urgent })
    }
  }
}

function getUpgradeArea(room) {
  const rcl = room.controller.level

  if (rcl >= 5 && roomUtils.getControllerLink(room)) {
    if (room.heap._controllerLinkArea) {
      return room.heap._controllerLinkArea
    }

    room.heap._controllerLinkArea = []

    const linkPos = roomUtils.getControllerLinkPos(room)

    const terrain = Game.map.getRoomTerrain(room.name)

    for (const coord of coordUtils.getCoordsAtRange(linkPos, 1)) {
      if (terrain.get(coord.x, coord.y) === TERRAIN_MASK_WALL) {
        continue
      }

      room.heap._controllerLinkArea.push(new RoomPosition(coord.x, coord.y, room.name))
    }

    return room.heap._controllerLinkArea
  }

  if (room.heap._controllerArea) {
    return room.heap._controllerArea
  }

  room.heap._controllerArea = []

  const terrain = Game.map.getRoomTerrain(room.name)

  for (const coord of coordUtils.getCoordsInRange(room.controller.pos, 3)) {
    if (terrain.get(coord.x, coord.y) === TERRAIN_MASK_WALL) {
      continue
    }

    room.heap._controllerArea.push(new RoomPosition(coord.x, coord.y, room.name))
  }

  return room.heap._controllerArea
}

/**
 *
 * @param {Room} room
 * @returns
 */
function getMaxWork(room) {
  const level = room.controller.level

  if (level < 2) {
    return 5
  }

  if (!room.memory.upgradeNeeded && room.controller.ticksToDowngrade < CONTROLLER_DOWNGRADE[level] / 2) {
    room.memory.upgradeNeeded = true
  } else if (room.memory.upgradeNeeded && room.controller.ticksToDowngrade >= CONTROLLER_DOWNGRADE[level]) {
    room.memory.upgradeNeeded = false
  }

  const energyLevel = roomUtils.getEnergyLevel(room)

  if (room.controller.level === 8) {
    if (room.memory.upgradeNeeded || energyLevel > config.economy.energyLevel.upgradeMaxLevel) {
      return CONTROLLER_MAX_UPGRADE_PER_TICK
    }
    return 0
  }

  let income = room.memory.maxIncome || 0

  if (room.memory.constructingIncome) {
    income -= room.memory.constructingIncome
  }

  if (room.memory.rampartRepairPower) {
    income -= room.memory.rampartRepairPower
  }

  // maxWork = income * upgrader efficiency(considering spawn cost) * energyLevel multiplier(1~1.2)

  let maxWork

  let multiplier

  if (room.storage) {
    multiplier = utils.clamp(roomUtils.getEnergyLevel(room) / 100, 0.5, 1.2)
  } else {
    multiplier = utils.clamp(room.memory.spawnBalance / 2 + 0.9, 0.5, 1.2)
  }

  maxWork = income * (25 / 27) * multiplier

  const lowerLimit = room.memory.upgradeNeeded ? 5 : 0

  const upperLimit = getUpgradeCapacity(room)

  return Math.floor(utils.clamp(income * (25 / 27) * multiplier, lowerLimit, upperLimit))
}

function getControllerMaxCarryPower(room) {
  let distance

  if (room.memory.controllerDistance) {
    distance = room.memory.controllerDistance
  } else {
    const path = pathUtils.findPath(roomUtils.getStartPos(room), [{ pos: room.controller.pos, range: 1 }], {
      heuristicWeight: 1,
      findRoute: false,
    })
    room.memory.controllerDistance = path.length
    distance = path.length
  }

  return 2 * room.memory.maxWork * distance
}

/**
 *
 * @param {Room} room
 * @param {Creep} creep
 * @param {[Creep]} upgraders
 * @param {Structure} energyDepot
 * @param {StructureController} controller
 * @returns
 */
function runUpgrader(room, creep, upgraders, controller, energyDepot, isResource) {
  if (creep.pos.getRangeTo(controller) > 3) {
    return
  }

  creep.upgradeController(controller)

  creep.setWorkingArea(controller.pos, 3)

  const numWork = (() => {
    if (creep.heap.numWork !== undefined) {
      return creep.heap.numWork
    }

    return (creep.heap.numWork = creep.getActiveBodyparts(WORK))
  })()

  if (!energyDepot) {
    creep.useRate = 1
    room.creepsToFill.push(creep)
    return
  }

  // if there is enough energy to upgrade until next tick, wait
  if (creep.store.getUsedCapacity(RESOURCE_ENERGY) >= 2 * numWork) {
    return
  }

  if (!isResource && energyDepot.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
    roomUtils.subtractSpawnBalance(room)
    creep.say("⏳", true)
    return
  }

  if (creep.pos.getRangeTo(energyDepot) <= 1) {
    if (isResource) {
      creep.pickup(energyDepot)
    } else {
      creep.withdraw(energyDepot, RESOURCE_ENERGY)
    }
    return
  }

  const candidate = upgraders.find((upgrader) => {
    if (upgrader.name === creep.name) {
      return false
    }

    if (upgrader._transfered) {
      return false
    }

    if (upgrader.pos.getRangeTo(creep) > 1) {
      return false
    }

    if (upgrader.pos.getRangeTo(energyDepot) >= creep.pos.getRangeTo(energyDepot)) {
      return false
    }

    if (upgrader.store.getUsedCapacity(RESOURCE_ENERGY) < 2 * upgrader.getActiveBodyparts(WORK)) {
      return false
    }

    return true
  })

  if (candidate) {
    candidate.transfer(creep, RESOURCE_ENERGY)
    candidate._transfered = true
    return
  }

  const pos = energyDepot.pos

  creepUtils.moveCreep(creep, { pos, range: 1 })
  return
}

function getUpgradeCapacity(room) {
  if (room.heap._upgradeCapacity) {
    return room.heap._upgradeCapacity
  }

  const controllerLink = roomUtils.getControllerLink(room)
  const storageLink = roomUtils.getStorageLink(room)

  if (!controllerLink || !storageLink) {
    return Infinity
  }

  const range = controllerLink.pos.getRangeTo(storageLink)

  const capacity = Math.floor(800 / (range + 1))

  return capacity
}

if (config.test.profiler) {
  manageUpgrade = screepsProfiler.registerFN(manageUpgrade, "manageUpgrade")
}

module.exports = manageUpgrade
