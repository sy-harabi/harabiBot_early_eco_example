const config = require("./config")
const screepsProfiler = require("./screeps-profiler")

let tempData = {}
let tempTick

const heap = {
  rooms: new Map(),

  creeps: new Map(),
}

const dataStorage = {
  /**
   * @returns {object}
   */
  get temp() {
    if (!tempTick || Game.time !== tempTick) {
      tempData = {}
      tempTick = Game.time
    }
    return tempData
  },

  /**
   * @returns {{rooms:Map,creeps:Map,managers:Map}}
   */
  get heap() {
    return heap
  },

  /**
   *
   * @param {string} creepName
   */
  clearCreepData(creepName) {
    Memory.creeps[creepName] = undefined
    this.heap.creeps.delete(creepName)
  },

  /**
   *
   * @param {String} roomName
   */
  clearRoomData(roomName) {
    if (Memory.rooms) {
      Memory.rooms[roomName] = undefined
    }
    dataStorage.heap.rooms.delete(roomName)
  },
}

if (config.test.profiler) {
  screepsProfiler.registerObject(dataStorage, "dataStorage")
}

module.exports = dataStorage
