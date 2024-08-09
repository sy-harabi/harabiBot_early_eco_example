const config = require("./config")
const constant = require("./constant")
const coordUtils = require("./coordUtils")
const dataStorage = require("./dataStorage")
const mapUtils = require("./mapUtils")
const roomUtils = require("./roomUtils")
const screepsProfiler = require("./screeps-profiler")
const MinHeap = require("./util_min_heap")
const utils = require("./utils")

const DEFAULT_MOVE_OPTS = config.movement.defaultOpts

const DEFAULT_ROUTE_CALLBACK = (roomName) => config.movement.defaultRoomCost[mapUtils.getRoomType(roomName)]

const pathUtils = {
  isValidPath(path, normalizedGoals) {
    const pathEnd = path[path.length - 1]
    return normalizedGoals.some((goal) => goal.pos.getRangeTo(pathEnd) <= goal.range)
  },

  getDefaultCostMatrixForInvisibleRoom(roomName) {
    const temp = dataStorage.temp

    temp.rooms = temp.rooms || {}

    temp.rooms[roomName] = temp.rooms[roomName] || {}

    if (temp.rooms[roomName]._defaultCostMatrixForInvisibleRoom) {
      return temp.rooms[roomName]._defaultCostMatrixForInvisibleRoom
    }

    const costs = new PathFinder.CostMatrix()

    const terrain = Game.map.getRoomTerrain(roomName)

    const intel = mapUtils.getIntel(roomName)

    if (!intel) {
      return costs
    }

    if (intel[constant.SCOUT_KEYS.KEEPER_LAIR_COORDS_PACKED]) {
      for (const coordPacked of intel[constant.SCOUT_KEYS.KEEPER_LAIR_COORDS_PACKED]) {
        const keeperLairCoord = coordUtils.unpackCoord(coordPacked)
        for (const coord of coordUtils.getCoordsInRange(keeperLairCoord, 4)) {
          if (terrain.get(coord.x, coord.y) === TERRAIN_MASK_WALL) {
            continue
          }
          costs.set(coord.x, coord.y, 5)
        }
      }

      for (const coordPacked of intel[constant.SCOUT_KEYS.SOURCE_COORDS_PACKED]) {
        const sourceCoord = coordUtils.unpackCoord(coordPacked)
        for (const coord of coordUtils.getCoordsInRange(sourceCoord, 4)) {
          if (terrain.get(coord.x, coord.y) === TERRAIN_MASK_WALL) {
            continue
          }
          costs.set(coord.x, coord.y, 5)
        }
      }
    }

    return (temp.rooms[roomName]._defaultCostMatrixForInvisibleRoom = costs)
  },

  /**
   *
   * @param {Room} room
   * @returns
   */
  getDefaultCostMatrix(room) {
    if (room._defaultCostMatrix) {
      return room._defaultCostMatrix
    }

    if (room.heap._defaultCostMatrix && Math.random() < 0.9) {
      return (room._defaultCostMatrix = room.heap._defaultCostMatrix)
    }

    const costs = pathUtils.getDefaultCostMatrixForInvisibleRoom(room.name).clone()

    for (const road of roomUtils.getStructuresByType(room, STRUCTURE_ROAD)) {
      costs.set(road.pos.x, road.pos.y, 1)
    }

    room.find(FIND_STRUCTURES).forEach((structure) => {
      if (OBSTACLE_OBJECT_TYPES.includes(structure.structureType)) {
        costs.set(structure.pos.x, structure.pos.y, 255)
        return
      }
      if (structure.structureType === STRUCTURE_RAMPART && !structure.my && !structure.isPublic) {
        costs.set(structure.pos.x, structure.pos.y, 255)
        return
      }
    })

    room.find(FIND_CONSTRUCTION_SITES).forEach((cs) => {
      if (OBSTACLE_OBJECT_TYPES.includes(cs.structureType)) {
        costs.set(cs.pos.x, cs.pos.y, 255)
      }
    })

    if (room.my) {
      const terrain = Game.map.getRoomTerrain(room.name)

      const startPos = roomUtils.getStartPos(room)

      costs.set(startPos.x, startPos.y, 20)

      for (const source of room.find(FIND_SOURCES).concat(room.find(FIND_MINERALS))) {
        for (const coord of coordUtils.getCoordsAtRange(source.pos, 1)) {
          if (terrain.get(coord.x, coord.y) === TERRAIN_MASK_WALL) {
            continue
          }

          if (
            !room.lookForAt(LOOK_CREEPS, coord.x, coord.y).some((creep) => creep.my && creep.memory.role === "miner")
          ) {
            continue
          }

          if (costs.get(coord.x, coord.y) < 5) {
            costs.set(coord.x, coord.y, 5)
          }
        }
      }
    }

    room.heap._defaultCostMatrix = costs

    return (room._defaultCostMatrix = costs)
  },

  /**
   *
   * @param {RoomPosition} startPos
   * @param {Array} normalizedGoals
   * @param {object} opts
   * @returns
   */
  findPath(startPos, normalizedGoals, opts = {}) {
    opts = { ...DEFAULT_MOVE_OPTS, ...opts }

    const allowedRooms = { [startPos.roomName]: true }

    if (opts.findRoute) {
      this.findRoute(
        startPos.roomName,
        normalizedGoals.map((goal) => goal.pos.roomName),
        opts,
      ).forEach((roomName) => {
        allowedRooms[roomName] = true
      })
    }

    const result = PathFinder.search(startPos, normalizedGoals, {
      plainCost: opts.plainCost,
      swampCost: opts.swampCost,
      heuristicWeight: opts.heuristicWeight,
      maxRooms: opts.maxRooms,
      maxOps: opts.findRoute
        ? Object.keys(allowedRooms).length * opts.maxOpsPerRoom
        : opts.maxOpsPerRoom * opts.maxRooms,
      flee: opts.flee,
      roomCallback(roomName) {
        if (opts.findRoute && allowedRooms[roomName] === undefined) {
          return false
        }

        if (opts.roomCallback) {
          return opts.roomCallback(roomName)
        }

        const room = Game.rooms[roomName]

        if (!room) {
          return pathUtils.getDefaultCostMatrixForInvisibleRoom(roomName)
        }

        let costs = opts.avoidObstacleStructures ? pathUtils.getDefaultCostMatrix(room) : new PathFinder.CostMatrix()

        if (opts.avoidCreeps) {
          costs = costs.clone()
          const creeps = room.find(FIND_CREEPS).concat(room.find(FIND_POWER_CREEPS))
          creeps.forEach((creep) => costs.set(creep.pos.x, creep.pos.y, 255))
        }

        return costs
      },
    })

    if (result.incomplete) {
      return
    }

    return result.path
  },

  findRouteToDesiredRoom(fromRoomName, desiredCallback, opts) {
    const routeCallback = opts.routeCallback || DEFAULT_ROUTE_CALLBACK

    const depthCache = {}

    depthCache[fromRoomName] = 0

    const cameFrom = new Map()

    const queue = new MinHeap((roomName) => depthCache[roomName] || Infinity)

    while (queue.getSize() > 0) {
      const current = queue.remove()

      if (desiredCallback(current)) {
        const result = OK
        const route = this.reconstructPath(cameFrom, current)
        return { result, route, roomName: current }
      }

      const depthCurrent = depthCache[current]

      if (opts.maxRooms && depthCurrent >= opts.maxRooms) {
        continue
      }

      const adjacents = this.getMapAjacents(current)

      for (const adjacent of adjacents) {
        const cost = routeCallback(adjacent)

        if (cost === Infinity) {
          continue
        }

        if (depthCache[adjacent] && depthCache[adjacent] <= depthCurrent + cost) {
          continue
        }

        depthCache[adjacent] = depthCurrent + cost

        cameFrom.set(adjacent, current)

        queue.push(adjacent)
      }
    }

    return { result: ERR_NO_PATH }
  },

  /**
   *
   * @param {string} fromRoomName
   * @param {[string]} toRoomNames
   * @param {*} opts
   * @returns
   */
  findRoute(fromRoomName, toRoomNames, opts = {}) {
    const routeCallback = opts.routeCallback || DEFAULT_ROUTE_CALLBACK

    const costs = new Map()

    costs.set(fromRoomName, 0)

    const cameFrom = new Map()

    const gScore = new Map()
    gScore.set(fromRoomName, 0)

    const heuristic = function (roomName) {
      const [x, y] = pathUtils.roomNameToXY(roomName)
      return Math.min(
        ...toRoomNames.map((roomName) => {
          const [toX, toY] = pathUtils.roomNameToXY(roomName)
          return Math.abs(x - toX) + Math.abs(y - toY)
        }),
      )
    }

    const fScore = new Map()
    fScore.set(fromRoomName, heuristic(fromRoomName))

    const openSet = new MinHeap((roomName) => fScore.get(roomName))

    const closedSet = new Set()

    openSet.insert(fromRoomName)

    while (openSet.getSize()) {
      const current = openSet.remove()

      if (toRoomNames.includes(current)) {
        return this.reconstructPath(cameFrom, current)
      }

      closedSet.add(current)

      for (const adjacent of this.getMapAjacents(current)) {
        if (closedSet.has(adjacent)) {
          continue
        }

        if (!openSet.has(adjacent)) {
          openSet.insert(adjacent, fScore.get(adjacent))
        }

        const gScoreAdjacent = gScore.get(current) + routeCallback(adjacent)

        if (gScoreAdjacent < (gScore.get(adjacent) || Infinity)) {
          cameFrom.set(adjacent, current)
          gScore.set(adjacent, gScoreAdjacent)
          fScore.set(adjacent, gScoreAdjacent + heuristic(adjacent))
        }
      }
    }

    return undefined
  },

  reconstructPath(cameFrom, current) {
    let totalPath = [current]
    while (cameFrom.has(current)) {
      current = cameFrom.get(current)
      totalPath.unshift(current)
    }
    return totalPath
  },

  /**
   * @typedef {object} mapShortestPathTree
   * @property {object} dist
   * @property {object} prev
   * @property {Array} sorted
   */

  /**
   *
   * @param {string} sourceRoomName
   * @param {number} maxRooms
   * @returns {mapShortestPathTree}
   */
  getMapShortestPathTree(sourceRoomName, maxRooms = OBSERVER_RANGE) {
    const dist = {}

    const prev = {}

    const sorted = []

    function getDistance(roomName) {
      if (dist[roomName] === undefined) {
        return Infinity
      }
      return dist[roomName]
    }

    const queue = new MinHeap(getDistance)

    dist[sourceRoomName] = 0

    queue.insert(sourceRoomName)

    while (queue.getSize() > 0) {
      const current = queue.remove()
      sorted.push(current)
      const currentDistance = getDistance(current)
      const adjacents = this.getMapAjacents(current)
      for (const adjacent of adjacents) {
        if (Game.map.getRoomStatus(adjacent).status !== "normal") {
          continue
        }

        const distanceBefore = getDistance(adjacent)
        const distanceAfter = currentDistance + 1

        if (distanceAfter < distanceBefore) {
          dist[adjacent] = distanceAfter
          prev[adjacent] = current
          if (distanceAfter < maxRooms) {
            queue.insert(adjacent)
          }
        }
      }
    }

    return { dist, prev, sorted }
  },

  roomNameToXY(name) {
    let xx = parseInt(name.substr(1), 10)
    let verticalPos = 2
    if (xx >= 100) {
      verticalPos = 4
    } else if (xx >= 10) {
      verticalPos = 3
    }
    let yy = parseInt(name.substr(verticalPos + 1), 10)
    let horizontalDir = name.charAt(0)
    let verticalDir = name.charAt(verticalPos)
    if (horizontalDir === "W" || horizontalDir === "w") {
      xx = -xx - 1
    }
    if (verticalDir === "N" || verticalDir === "n") {
      yy = -yy - 1
    }
    return [xx, yy]
  },

  getMapAjacents(roomName) {
    const describeExits = Game.map.describeExits(roomName)
    if (!describeExits) {
      return []
    }
    return Object.values(describeExits)
  },
}

if (config.test.profiler) {
  screepsProfiler.registerObject(pathUtils, "pathUtils")
}

module.exports = pathUtils
