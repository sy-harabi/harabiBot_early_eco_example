const config = require("./config")
const roomUtils = require("./roomUtils")
const screepsProfiler = require("./screeps-profiler")
const utils = require("./utils")

/**
 *
 * @param {Room} room
 */
let manageDefense = function (room) {
  let hostileCreeps

  if (room.memory.danger) {
    hostileCreeps = roomUtils.findHostileCreeps(room)
  }

  manageTowers(room, hostileCreeps)
}

/**
 *
 * @param {Room} room
 * @param {[Creep]} hostileCreeps
 * @returns
 */
function manageTowers(room, hostileCreeps) {
  const towers = roomUtils.getStructuresByType(room, STRUCTURE_TOWER)

  if (towers.length === 0) {
    return
  }

  if (hostileCreeps) {
    const target = utils.getMinObject(hostileCreeps, (creep) => {
      return towers.reduce((prev, curr) => prev + creep.pos.getRangeTo(curr), 0)
    })

    towers.forEach((tower) => tower.attack(target))

    return
  }

  const damagedRoads = roomUtils.getStructuresByType(room, "damaged")

  if (damagedRoads.length === 0) {
    return
  }

  towers.forEach((tower) => {
    const closestRoad = tower.pos.findClosestByRange(damagedRoads)
    tower.repair(closestRoad)
  })
}

if (config.test.profiler) {
  manageDefense = screepsProfiler.registerFN(manageDefense, "manageDefense")
}

module.exports = manageDefense
