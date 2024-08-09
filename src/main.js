require("./Room_prototype")
require("./Creep_prototype")

const config = require("./config")
const utils = require("./utils")
const profiler = require("./screeps-profiler")
const roomManager = require("./roomManager")
const spawnManager = require("./spawnManger")
const trafficManager = require("./traffic_manager")
const pathUtils = require("./pathUtils")
const statistics = require("./statistics")
const memhack = require("./memhack")
const drawDashboard = require("./dashboard")
const missionManager = require("./missionManager")
const dataStorage = require("./dataStorage")

trafficManager.init()
statistics.init()

if (config.test.profiler) {
  profiler.enable()
}

module.exports.loop = memhack(function () {
  profiler.wrap(function () {
    if (utils.hasRespawned() || Memory.respawn) {
      Memory.respawn = undefined
      console.log(`RESPAWN`)

      for (const roomName in Game.rooms) {
        dataStorage.clearRoomData(roomName)
      }

      for (const creepName in Game.creeps) {
        dataStorage.clearCreepData(creepName)
      }

      for (const key in Memory) {
        Memory[key] = undefined
      }

      Memory.rooms = {}
      Memory.creeps = {}

      statistics.init()

      return
    }

    statistics.pretick()

    const rooms = Object.values(Game.rooms)
    roomManager.preTick(rooms)
    spawnManager.preTick()

    // should be below of roomManager & spawnManager
    missionManager.pretick()

    missionManager.run()

    roomManager.run(rooms)
    spawnManager.run()

    manageTraffic(rooms)

    drawDashboard()

    statistics.endTick()
  })
})

/**
 *
 * @param {[Room]} rooms
 */
function manageTraffic(rooms) {
  for (const room of rooms) {
    const costs = pathUtils.getDefaultCostMatrix(room)
    trafficManager.run(room, costs, 20)
  }
}
