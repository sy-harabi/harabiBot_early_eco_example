const mincutToExit = require("./util_algorithm_mincut")

const algorithm = {
  mincutToExit,

  /**
   * get distance trasform of a room
   * @param {string} roomName
   * @param {object} options - {innerPositions, visual}
   * @param {Array} options.innerPositions - positions which are considered inside.
   * @param {boolean} options.visual - whether or not show the result as roomVisual
   * @returns
   */
  getDistanceTransform(roomName, options = {}) {
    const defaultOptions = { innerPositions: undefined, visual: false }
    const mergedOptions = { ...defaultOptions, ...options }
    const { innerPositions, visual } = mergedOptions

    const BOTTOM_LEFT = [
      { x: -1, y: 0 },
      { x: 0, y: -1 },
      { x: -1, y: -1 },
      { x: -1, y: 1 },
    ]

    const TOP_RIGHT = [
      { x: 1, y: 0 },
      { x: 0, y: +1 },
      { x: 1, y: 1 },
      { x: 1, y: -1 },
    ]

    let costs = new PathFinder.CostMatrix()

    const terrain = new Room.Terrain(roomName)

    if (innerPositions === undefined) {
      for (let x = 0; x <= 49; x++) {
        for (let y = 0; y <= 49; y++) {
          if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
            costs.set(x, y, 0)
            continue
          }
          if (x <= 1 || x >= 48 || y <= 1 || y >= 48) {
            costs.set(x, y, 0)
            continue
          }
          costs.set(x, y, 1 << 8)
        }
      }
    } else {
      for (const pos of innerPositions) {
        costs.set(pos.x, pos.y, 1 << 8)
      }
    }

    for (let x = 0; x <= 49; x++) {
      for (let y = 0; y <= 49; y++) {
        const nearDistances = BOTTOM_LEFT.map((vector) => costs.get(x + vector.x, y + vector.y) + 1 || 100)
        nearDistances.push(costs.get(x, y))
        costs.set(x, y, Math.min(...nearDistances))
      }
    }

    const positionsByLevel = {}

    for (let x = 49; x >= 0; x--) {
      for (let y = 49; y >= 0; y--) {
        const nearDistances = TOP_RIGHT.map((vector) => costs.get(x + vector.x, y + vector.y) + 1 || 100)
        nearDistances.push(costs.get(x, y))
        const distance = Math.min(...nearDistances)
        costs.set(x, y, distance)
        if (!positionsByLevel[distance]) {
          positionsByLevel[distance] = []
        }
        positionsByLevel[distance].push(new RoomPosition(x, y, roomName))
      }
    }

    if (visual) {
      const roomVisual = new RoomVisual(roomName)

      const maxLevel = Math.max(...Object.keys(positionsByLevel))
      for (let x = 49; x >= 0; x--) {
        for (let y = 49; y >= 0; y--) {
          if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
            continue
          }
          const cost = costs.get(x, y)
          const hue = 180 * (1 - cost / maxLevel)
          const color = `hsl(${hue},100%,60%)`
          roomVisual.text(cost, x, y)
          roomVisual.rect(x - 0.5, y - 0.5, 1, 1, { fill: color, opacity: 0.4 })
        }
      }
    }

    return { positions: positionsByLevel, costs }
  },

  getFloodFillPositions(roomName, startPositions, threshold, options) {
    const ADJACENT_VECTORS = [
      { x: 0, y: -1 }, // TOP
      { x: 1, y: -1 }, // TOP_RIGHT
      { x: 1, y: 0 }, // RIGHT
      { x: 1, y: 1 }, // BOTTOM_RIGHT
      { x: 0, y: 1 }, // BOTTOM
      { x: -1, y: 1 }, // BOTTOM_LEFT
      { x: -1, y: 0 }, // LEFT
      { x: -1, y: -1 }, // TOP_LEFT
    ]

    const defaultOptions = { maxLevel: 50, costThreshold: 255, visual: false }
    const mergedOptions = { ...defaultOptions, ...options }
    let { maxLevel, costMatrix, costThreshold, visual } = mergedOptions

    if (costMatrix === undefined) {
      costMatrix = new PathFinder.CostMatrix()
    } else {
      costMatrix = costMatrix.clone()
    }

    const queue = []

    const result = []

    const terrain = Game.map.getRoomTerrain(roomName)

    const check = new PathFinder.CostMatrix()

    for (const pos of startPositions) {
      queue.push(pos)
      costMatrix.set(pos.x, pos.y, 0)
      check.set(pos.x, pos.y, 1)
    }

    const roomVisual = new RoomVisual(roomName)

    while (queue.length && result.length < threshold) {
      const current = queue.shift()
      const currentLevel = costMatrix.get(current.x, current.y)

      if (currentLevel >= maxLevel) {
        continue
      }

      for (const vector of ADJACENT_VECTORS) {
        const x = current.x + vector.x
        const y = current.y + vector.y
        if (x < 0 || x > 49 || y < 0 || y > 49) {
          continue
        }

        if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
          continue
        }

        if (costMatrix.get(x, y) >= costThreshold) {
          continue
        }

        if (check.get(x, y) > 0) {
          continue
        }

        costMatrix.set(x, y, currentLevel + 1)

        check.set(x, y, 1)

        queue.push({ x, y })

        const pos = new RoomPosition(x, y, roomName)
        result.push(pos)

        if (visual) {
          roomVisual.text(currentLevel + 1, x, y)
        }
      }
    }

    return result
  },
}

module.exports = algorithm
