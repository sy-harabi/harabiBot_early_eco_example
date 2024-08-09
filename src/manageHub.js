const config = require("./config")
const creepUtils = require("./creepUtils")
const roomUtils = require("./roomUtils")
const screepsProfiler = require("./screeps-profiler")

/**
 *
 * @param {Room} room
 */
let manageHub = function manageHub(room) {
  const storage = room.storage
  const terminal = room.terminal
  const storageLink = roomUtils.getStorageLink(room)

  if ([storage, terminal, storageLink].filter((structure) => !!structure).length < 2) {
    return
  }

  const distributors = roomUtils.getCreepsByRole(room, "distributor")

  const distributor = distributors[0]

  if (distributor) {
    runDistributor(room, distributor)
  }

  if (!room.memory.canSpawn) {
    return
  }

  if (
    !distributors.find(
      (distributor) => (distributor.ticksToLive || 1500) > distributor.body.length * CREEP_SPAWN_TIME + 20,
    )
  ) {
    const maxEnergy = Math.max(250, room.energyAvailable - 50)

    const body = [MOVE]

    for (let i = 0; i < Math.min(Math.floor(maxEnergy / 50), 16); i++) {
      body.push(CARRY)
    }

    global.requestCreep(room, body, "distributor")

    return
  }
}

/**
 *
 * @param {Room} room
 * @param {Creep} creep
 */
function runDistributor(room, creep) {
  const startPos = roomUtils.getStartPos(room)

  if (creep.pos.getRangeTo(startPos) > 0) {
    creepUtils.moveCreep(creep, { pos: startPos, range: 0 })
    return
  }

  const target = getTarget(room)

  if (!target) {
    return
  }

  if (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
    creep.transfer(target, RESOURCE_ENERGY)
    return
  }

  const energySource = getEnergySource(room, creep, target)

  if (energySource) {
    creep.withdraw(energySource, RESOURCE_ENERGY)
  }
}

/**
 *
 * @param {Room} room
 * @param {Creep} creep
 * @param {Structure} target
 * @returns
 */
function getEnergySource(room, creep, target) {
  const storageLink = roomUtils.getStorageLink(room)
  if (storageLink && storageLink.store.getUsedCapacity(RESOURCE_ENERGY) && target.structureType !== STRUCTURE_LINK) {
    return storageLink
  }

  const storage = room.storage

  const freeCapacity = creep.store.getFreeCapacity(RESOURCE_ENERGY)

  if (storage && storage.store.getUsedCapacity(RESOURCE_ENERGY) >= freeCapacity) {
    return storage
  }

  const terminal = room.terminal

  if (
    terminal &&
    terminal.store.getUsedCapacity(RESOURCE_ENERGY) >= freeCapacity &&
    target.structureType !== STRUCTURE_TERMINAL
  ) {
    return terminal
  }
}

/**
 *
 * @param {Room} room
 * @returns
 */
function getTarget(room) {
  const spawns = roomUtils.getStructuresByType(room, STRUCTURE_SPAWN)
  const emptySpawn = spawns.find((spawn) => spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0)
  const storage = room.storage

  if (emptySpawn && storage && storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    return emptySpawn
  }

  const storageLink = roomUtils.getStorageLink(room)
  const controllerLink = roomUtils.getControllerLink(room)

  if (
    storageLink &&
    controllerLink &&
    controllerLink.store.getUsedCapacity(RESOURCE_ENERGY) <= (room.memory.numWork || 0) * 3
  ) {
    return storageLink
  }

  const terminal = room.terminal

  if (
    terminal &&
    terminal.store.getFreeCapacity(RESOURCE_ENERGY) &&
    terminal.store.getUsedCapacity(RESOURCE_ENERGY) < config.economy.energyInTerminal
  ) {
    return terminal
  }

  const powerSpawn = roomUtils.getStructuresByType(room, STRUCTURE_POWER_SPAWN)[0]
  if (
    powerSpawn &&
    powerSpawn.store[RESOURCE_POWER] > 0 &&
    powerSpawn.store[RESOURCE_ENERGY] < powerSpawn.store[RESOURCE_POWER] * 50
  ) {
    return powerSpawn
  }

  return
}

if (config.test.profiler) {
  manageHub = screepsProfiler.registerFN(manageHub, "manageHub")
}

module.exports = manageHub
