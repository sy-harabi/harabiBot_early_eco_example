const config = require("./config")
const screepsProfiler = require("./screeps-profiler")
const MinHeap = require("./util_min_heap")

const coordUtils = {
  /**
   *
   * @param {Room} room
   * @param {object} coord
   * @param {string} structureType
   */
  getStructuresByType(room, coord, structureType) {
    return room
      .lookForAt(LOOK_STRUCTURES, coord.x, coord.y)
      .find((structure) => structure.structureType === structureType)
  },

  isEdge(coord) {
    return coord.x === 0 || coord.x === 49 || coord.y === 0 || coord.y === 49
  },

  sortByPath(array, from, roomName, costs) {
    const terrain = Game.map.getRoomTerrain(roomName)

    costs = costs ? costs.clone() : new PathFinder.CostMatrix()

    const goals = {}

    for (const obj of array) {
      const pos = obj.pos || obj

      const x = pos.x
      const y = pos.y

      goals[x] = goals[x] || {}
      goals[x][y] = obj
    }

    function isGoal(pos) {
      return goals[pos.x] && goals[pos.x][pos.y]
    }

    function deleteGoal(pos) {
      delete goals[pos.x][pos.y]
    }

    const _dist = new PathFinder.CostMatrix()

    function getDistance(pos) {
      const cost = _dist.get(pos.x, pos.y)

      if (_dist.get(pos.x, pos.y) === 0) {
        return Infinity
      }
      return cost - 1
    }

    function setDistance(pos, distance) {
      _dist.set(pos.x, pos.y, distance + 1)
    }

    const queue = new MinHeap(getDistance)

    if (Array.isArray(from)) {
      for (const obj of from) {
        const pos = obj.pos || obj

        setDistance(pos, 0)

        queue.insert(pos)
      }
    } else {
      const pos = from.pos || from

      setDistance(pos, 0)

      queue.insert(pos)
    }

    const sorted = []

    const distance = []

    let i = 0

    outer: while (queue.getSize() > 0) {
      const current = queue.remove()

      const currentDistance = getDistance(current)

      const adjacents = this.getCoordsAtRange(current, 1)

      for (const adjacent of adjacents) {
        if (isGoal(adjacent)) {
          sorted.push(goals[adjacent.x][adjacent.y])

          distance.push(currentDistance)

          i++

          if (i >= array.length) {
            break outer
          }

          deleteGoal(adjacent)
        }

        if (terrain.get(adjacent.x, adjacent.y) === TERRAIN_MASK_WALL) {
          continue
        }

        const cost = costs.get(adjacent.x, adjacent.y)

        if (cost === 255) {
          continue
        }

        const distanceBefore = getDistance(adjacent)

        const distanceAfter = currentDistance + (cost || 1)

        if (distanceAfter < distanceBefore) {
          setDistance(adjacent, distanceAfter)
          queue.insert(adjacent)
        }
      }
    }

    return { sorted, distance }
  },

  getIsEqual(firstCoord, secondCoord) {
    return firstCoord.x === secondCoord.x && firstCoord.y === secondCoord.y
  },

  getAverageRange(coord, array) {
    let sum = 0

    if (array.length === 0) {
      throw new Error(`there is no element in target array`)
    }

    for (const goal of array) {
      sum += this.getRange(coord, goal)
    }
    return sum / array.length
  },

  getCoordsInRange(coord, range) {
    const result = []

    for (let x = coord.x - range; x <= coord.x + range; x++) {
      if (x < 0 || x > 49) {
        continue
      }
      for (y = coord.y - range; y <= coord.y + range; y++) {
        if (y < 0 || y > 49) {
          continue
        }
        result.push({ x, y })
      }
    }
    return result
  },

  getCoordsAtRange(coord, range) {
    const result = []

    const minX = coord.x - range
    const maxX = coord.x + range
    const minY = coord.y - range
    const maxY = coord.y + range

    for (const x of [minX, maxX]) {
      if (x < 0 || x > 49) {
        continue
      }
      for (let y = Math.max(0, minY); y <= Math.min(49, maxY); y++) {
        result.push({ x, y })
      }
    }

    for (const y of [minY, maxY]) {
      if (y < 0 || y > 49) {
        continue
      }
      for (let x = Math.max(0, minX + 1); x <= Math.min(49, maxX - 1); x++) {
        result.push({ x, y })
      }
    }

    return result
  },

  getRange(firstCoord, secondCoord) {
    return Math.max(Math.abs(firstCoord.x - secondCoord.x), Math.abs(firstCoord.y - secondCoord.y))
  },

  checkValidity(coord) {
    return coord.x >= 0 && coord.x <= 49 && coord.y >= 0 && coord.y <= 49
  },

  getRangeToEdge(coord) {
    return Math.min(coord.x, 49 - coord.x, coord.y, 49 - coord.y)
  },

  packCoord(coord) {
    const x = coord.x
    const y = coord.y
    return 50 * y + x
  },

  unpackCoord(packed) {
    const x = packed % 50
    const y = (packed - x) / 50
    return { x, y }
  },
}

if (config.test.profiler) {
  screepsProfiler.registerObject(coordUtils, "coordUtils")
}

module.exports = coordUtils
