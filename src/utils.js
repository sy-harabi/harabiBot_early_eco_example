const config = require("./config")
const screepsProfiler = require("./screeps-profiler")
const MinHeap = require("./util_min_heap")

const utils = {
  /**
   *
   * @param {CostMatrix} costs
   */
  visualizeCostMatrix(room, costs) {
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        const cost = costs.get(x, y)
        if (cost === 0) {
          continue
        }
        room.visual.text(cost, x, y)
      }
    }
  },

  /**
   *
   * @param {[RoomPosition]} path
   * @param {RoomPosition} startPos (optional)
   */
  visualizePath(path, startPos) {
    for (let i = path.length - 1; i >= 0; i--) {
      const posNow = path[i]
      const posNext = path[i - 1] || startPos
      if (!posNext) {
        return
      }
      if (posNow.roomName === posNext.roomName) {
        new RoomVisual(posNow.roomName).line(posNow, posNext, {
          color: "aqua",
          width: 0.15,
          opacity: 0.2,
          lineStyle: "dashed",
        })
      }
      if (startPos && posNext.isEqualTo(startPos)) {
        return
      }
    }
  },

  /**
   * adjust decimal
   * @param {number} number
   * @param {number} digit
   */
  adjustDecimal(number, digit) {
    const multiplier = 10 ** digit
    return Math.floor(number * multiplier) / multiplier
  },

  /**
   *
   * @param {Array} array - array of objects
   * @param {function(element):number} callback function that get value from elements of the array
   * @returns sum of all function values of elements of the array
   */
  getSum(array, callback) {
    let result = 0

    for (const element of array) {
      if (callback) {
        result += callback(element)
        continue
      }

      result += element
    }

    return result
  },

  /**
   * Adjust value to be between min and max
   * @param {number} value - value to adjust
   * @param {number} min - minimum
   * @param {number} max - maximum
   * @returns value adjusted to be in between min and max
   */
  clamp(value, min, max) {
    if (value < min) {
      return min
    }

    if (value > max) {
      return max
    }

    return value
  },

  /**
   * Get object with maximum callback value
   * @param {Array} array - array of objects
   * @param {function (object):number} callback - callback function
   * @param {function (object):boolean} filter - (optional) filter function
   * @returns
   */
  getMaxObject(array, callback, filter) {
    if (!array.length) {
      return undefined
    }
    let maximumElement
    let maximumValue = -Infinity
    for (const element of array) {
      if (filter && !filter(element)) {
        continue
      }

      const value = callback(element)

      if (value > maximumValue) {
        maximumElement = element
        maximumValue = value
      }
    }
    return maximumElement
  },

  /**
   * Get array of objects with maximum callback values
   * @param {Array} array - array of objects
   * @param {function (object):number} callback - callback function
   * @param {number} number - number of objects that we want to get
   * @param {function (object):boolean} filter - (optional) filter function
   * @returns
   */
  getMaxObjects(array, callback, number, filter) {
    const heap = new MinHeap(callback)
    let criteria = -Infinity
    for (const element of array) {
      if (filter && !filter(element)) {
        continue
      }

      if (heap.getSize() < number || callback(element) > criteria) {
        if (heap.getSize() >= number) {
          heap.remove()
        }
        heap.insert(element)
        criteria = callback(heap.getMin())
      }
    }
    return heap.toArray()
  },

  /**
   * Get object with minimum callback value
   * @param {Array} array - array of objects
   * @param {function (object):number} callback - callback function
   * @param {function (object):boolean} filter - (optional) filter function
   * @returns
   */
  getMinObject(array, callback, filter) {
    const newCallback = (element) => -1 * callback(element)
    return this.getMaxObject(array, newCallback, filter)
  },

  /**
   * Get array of objects with minimum callback values
   * @param {Array} array - array of objects
   * @param {function (object):number} callback - callback function
   * @param {number} number - number of objects that we want to get
   * @param {function (object):boolean} filter - (optional) filter function
   * @returns
   */
  getMinObjects(array, callback, number, filter) {
    const newCallback = (element) => -1 * callback(element)
    return this.getMaxObjects(array, newCallback, number, filter)
  },

  /* Posted March 31st, 2018 by @semperrabbit*/

  /**
   * global.hasRespawned()
   *
   * @author:  SemperRabbit
   * @version: 1.1
   * @date:    180331
   * @return:  boolean whether this is the first tick after a respawn or not
   *
   * The checks are set as early returns in case of failure, and are ordered
   * from the least CPU intensive checks to the most. The checks are as follows:
   *
   *      If it has returned true previously during this tick, return true again
   *      Check Game.time === 0 (returns true for sim room "respawns")
   *      There are no creeps
   *      There is only 1 room in Game.rooms
   *      The 1 room has a controller
   *      The controller is RCL 1 with no progress
   *      The controller is in safemode with the initial value
   *      There is only 1 StructureSpawn
   *
   * The only time that all of these cases are true, is the first tick of a respawn.
   * If all of these are true, you have respawned.
   *
   * v1.1 (by qnz): - fixed a condition where room.controller.safeMode can be SAFE_MODE_DURATION too
   *                - improved performance of creep number check (https://jsperf.com/isempty-vs-isemptyobject/23)
   */
  hasRespawned() {
    // check for multiple calls on same tick

    // check for 0 creeps
    for (const creepName in Game.creeps) {
      return false
    }

    // check for only 1 room
    const rNames = Object.keys(Game.rooms)
    if (rNames.length !== 1) {
      return false
    }

    // check for controller, progress and safe mode
    const room = Game.rooms[rNames[0]]
    if (
      !room.controller ||
      !room.controller.my ||
      room.controller.level !== 1 ||
      room.controller.progress ||
      !room.controller.safeMode ||
      room.controller.safeMode <= SAFE_MODE_DURATION - 1
    ) {
      return false
    }

    // check for 1 spawn
    if (Object.keys(Game.spawns).length > 1) {
      return false
    }

    return true
  },

  getTowerDamage(range) {
    return this.clamp(750 - 30 * range, 150, 600)
  },
}

if (config.test.profiler) {
  screepsProfiler.registerObject(utils, "utils")
}

module.exports = utils
