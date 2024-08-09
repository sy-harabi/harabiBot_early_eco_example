const constant = require("./constant")
const utils = require("./utils")
const algorithm = require("./util_algorithm")
const coordUtils = require("./coordUtils")
const MinHeap = require("./util_min_heap")
const mapUtils = require("./mapUtils")
const { colors } = require("./util_roomVisual_prototype")
const config = require("./config")

const CLUSTER_STAMP = [
  { x: -1, y: -1, structureType: STRUCTURE_SPAWN },
  { x: 0, y: -1, structureType: STRUCTURE_SPAWN },
  { x: 1, y: -1, structureType: STRUCTURE_SPAWN },
  { x: -1, y: 0, structureType: STRUCTURE_TERMINAL },
  { x: 1, y: 0, structureType: STRUCTURE_LINK },
  { x: -1, y: 1, structureType: STRUCTURE_STORAGE },
  { x: +1, y: 1, structureType: STRUCTURE_POWER_SPAWN },
  { x: 0, y: 1, structureType: STRUCTURE_ROAD },
  { x: -2, y: -1, structureType: "road" },
  { x: -2, y: 0, structureType: "road" },
  { x: -2, y: 1, structureType: "road" },
  { x: -1, y: -2, structureType: "road" },
  { x: -1, y: 2, structureType: "road" },
  { x: 0, y: -2, structureType: "road" },
  { x: 1, y: -2, structureType: "road" },
  { x: 1, y: 2, structureType: "road" },
  { x: 2, y: -1, structureType: "road" },
  { x: 2, y: 0, structureType: "road" },
  { x: 2, y: 1, structureType: "road" },
]

const OVERLAPPABLE_STRUCTURES = [STRUCTURE_ROAD, STRUCTURE_RAMPART]

const BASE_PLAN_MASK = {
  spawn: 1,
  extension: 2,
  constructedWall: 3,
  link: 5,
  storage: 6,
  tower: 7,
  observer: 8,
  powerSpawn: 9,
  extractor: 10,
  lab: 11,
  terminal: 12,
  container: 13,
  nuker: 14,
  factory: 15,
  road: 1 << 4,
  rampart: 1 << 5,
}

const RCL_TO_BUILD_RAMPART = config.economy.rclToBuildRampart

const STRUCTURE_MASK = (1 << 4) - 1

const basePlanner = {
  /**
   * @typedef {object} basePlan
   * @property {{x:number,y:number}} startCoord
   * @property {[[{coord:{x,y},structureType:string}]]} structures
   * @property {{sources:{},controller:{x,y},storage:{x,y}}} links
   * @property {{[id:string]:{x,y}}} containers
   */

  /**
   * @param {String} roomName
   * @returns {basePlan}
   */
  getBasePlan(roomName) {
    const room = Game.rooms[roomName]

    if (!Memory.rooms[roomName].resetBasePlan) {
      if (room && room.heap.basePlan) {
        return room.heap.basePlan
      }

      if (Memory.rooms[roomName] && Memory.rooms[roomName].basePlan) {
        const unpackedBasePlan = this.unpackBasePlan(Memory.rooms[roomName].basePlan)
        if (unpackedBasePlan) {
          if (room) {
            room.heap.basePlan = unpackedBasePlan
          }
          return unpackedBasePlan
        }
      }
    }

    Memory.rooms[roomName].resetBasePlan = undefined

    console.log(`Calculate base plan for ${roomName}`)

    // set result
    const result = {}

    result.structures = new Array(9)

    for (let i = 1; i <= 8; i++) {
      result.structures[i] = []
    }

    result.structurePositions = {}

    for (const key in BASE_PLAN_MASK) {
      result.structurePositions[key] = []
    }

    // set up

    const terrain = Game.map.getRoomTerrain(roomName)

    const basePlanCosts = new PathFinder.CostMatrix()

    const pathFindingCosts = new PathFinder.CostMatrix()

    const roomVisual = new RoomVisual(roomName)

    const mincutSources = []

    // get exit coords

    const exitCoords = []
    for (let x = 1; x < 49; x++) {
      for (const y of [0, 49])
        if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
          exitCoords.push({ x, y })
          pathFindingCosts.set(x, y, 255)
        }
    }
    for (let y = 1; y < 49; y++) {
      for (const x of [0, 49])
        if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
          exitCoords.push({ x, y })
          pathFindingCosts.set(x, y, 255)
        }
    }

    // get startPos
    const pointsOfInterest = this.getPointsOfInterest(room)

    const startPos = this.getStartPos(roomName, pointsOfInterest, exitCoords)

    if (!startPos) {
      return
    }

    result.startPos = coordUtils.packCoord(startPos)

    const links = {}
    links.sources = {}

    // first stamp

    let storageLinkCoord

    for (const stamp of CLUSTER_STAMP) {
      const x = startPos.x + stamp.x
      const y = startPos.y + stamp.y

      const coord = { x, y }

      mincutSources.push(coord)

      if (stamp.structureType === STRUCTURE_ROAD) {
        if (pathFindingCosts.get(x, y) === 0) {
          pathFindingCosts.set(x, y, 1)
          this.placeStructure(result, basePlanCosts, coord, STRUCTURE_ROAD, 3)
        }
      } else {
        this.placeStructure(result, basePlanCosts, coord, stamp.structureType)
        pathFindingCosts.set(x, y, 255)

        if (stamp.structureType === STRUCTURE_LINK) {
          links.storage = coordUtils.packCoord(coord)
          storageLinkCoord = coord
        }
      }
    }

    // upgrade area
    const upgradeSpotCoord = (() => {
      const upgradeCoords = coordUtils.getCoordsInRange(pointsOfInterest.controllerCoord, 3)
      const result = utils.getMaxObject(upgradeCoords, (coord) => {
        if (terrain.get(coord.x, coord.y) === TERRAIN_MASK_WALL) {
          return -Infinity
        }

        const rangeToStorageLink = coordUtils.getRange(storageLinkCoord, coord)

        const numOpenPositions = coordUtils.getCoordsInRange(coord, 1).filter((coord) => {
          if (terrain.get(coord.x, coord.y) === TERRAIN_MASK_WALL) {
            return false
          }
          if (pathFindingCosts.get(coord.x, coord.y) > 0) {
            return false
          }

          if (coordUtils.getRange(pointsOfInterest.controllerCoord, coord) > 3) {
            return false
          }
          return true
        }).length

        return (numOpenPositions << 2) - rangeToStorageLink
      })

      return result
    })()

    this.placeStructure(result, basePlanCosts, upgradeSpotCoord, STRUCTURE_LINK)
    links.controller = coordUtils.packCoord(upgradeSpotCoord)

    roomVisual.rect(upgradeSpotCoord.x - 1.5, upgradeSpotCoord.y - 1.5, 3, 3, {
      fill: "transparent",
      stroke: colors.yellow,
    })

    const upgradeAreaCoords = coordUtils.getCoordsInRange(upgradeSpotCoord, 1).filter((coord) => {
      if (terrain.get(coord.x, coord.y) === TERRAIN_MASK_WALL) {
        return false
      }
      if (pathFindingCosts.get(coord.x, coord.y) > 0) {
        return false
      }
      if (coordUtils.getRange(pointsOfInterest.controllerCoord, coord) > 3) {
        return false
      }
      return true
    })

    // set floodfill costMatrix
    const floodFiilCosts = pathFindingCosts.clone()

    // block positions near exit
    for (const coord of exitCoords) {
      const dangerArea = coordUtils.getCoordsInRange(coord, 4)
      for (const dangerCoord of dangerArea) {
        floodFiilCosts.set(dangerCoord.x, dangerCoord.y, 255)
      }
    }

    // set cost 255 to walls
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
          floodFiilCosts.set(x, y, 255)
        }
      }
    }

    // block upgrade area
    for (const coord of upgradeAreaCoords) {
      floodFiilCosts.set(coord.x, coord.y, 255)
    }

    // block area near source
    for (const sourcePos of Object.values(pointsOfInterest.sourceCoords)) {
      const area = coordUtils.getCoordsInRange(sourcePos, 2)
      for (const coord of area) {
        if (terrain.get(coord.x, coord.y) !== TERRAIN_MASK_WALL) {
          floodFiilCosts.set(coord.x, coord.y, 255)
        }
      }
    }

    const clusterPositions = CLUSTER_STAMP.map(
      (vector) => new RoomPosition(startPos.x + vector.x, startPos.y + vector.y, roomName),
    )

    // use floodfill to sort positions by reachability
    // 60 extensions, 10 labs, 6 towers, 1 factory, 1 observer, 1 nuker
    const floodFillPositions = algorithm.getFloodFillPositions(roomName, clusterPositions, Infinity, {
      costMatrix: floodFiilCosts,
      visual: false,
    })

    function mod(m, n) {
      return ((m % n) + n) % n
    }

    const CROSS_VECTORS = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]

    const BORDER_VECTORS = [
      { x: 2, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 2 },
      { x: -1, y: 1 },
      { x: -2, y: 0 },
      { x: -1, y: -1 },
      { x: 0, y: -2 },
      { x: 1, y: -1 },
    ]

    const CENTER_SUM = mod(startPos.x + startPos.y - 1, 4)
    const CENTER_DIFF = mod(startPos.x - startPos.y + 1, 4)
    const ROAD_SUM = mod(CENTER_SUM + 2, 4)
    const ROAD_DIFF = mod(CENTER_DIFF + 2, 4)

    let floodFillResults = []

    for (const pos of floodFillPositions) {
      // skip if coord is for road
      if (mod(pos.x + pos.y, 4) === ROAD_SUM || mod(pos.x - pos.y, 4) === ROAD_DIFF) {
        continue
      }

      if (mod(pos.x + pos.y, 4) === CENTER_SUM) {
        const borders = BORDER_VECTORS.map((vector) => new RoomPosition(pos.x + vector.x, pos.y + vector.y, roomName))

        for (let i = 0; i < borders.length; i++) {
          const border = borders[i]
          border.index = i
          border.adjacents = [borders[(borders.length + i - 1) % borders.length], borders[(i + 1) % borders.length]]
        }

        const openPositions = borders.filter((borderPos) => floodFiilCosts.get(borderPos.x, borderPos.y) < 255)

        if (openPositions.length === 0) {
          continue
        }

        const start = openPositions[0]

        let result = 1

        const queue = [start]

        const checked = {}

        checked[start.index] = true

        while (queue.length > 0) {
          const current = queue.shift()

          for (const adjacent of current.adjacents) {
            if (checked[adjacent.index]) {
              continue
            }
            checked[adjacent.index] = true

            if (floodFiilCosts.get(adjacent.x, adjacent.y) === 255) {
              continue
            }

            queue.push(adjacent)

            result++
          }
        }

        if (result < openPositions.length) {
          continue
        }
      } else if (floodFiilCosts.get(pos.x + 1, pos.y) === 255 && floodFiilCosts.get(pos.x - 1, pos.y) === 255) {
        continue
      } else if (floodFiilCosts.get(pos.x, pos.y + 1) === 255 && floodFiilCosts.get(pos.x, pos.y - 1) === 255) {
        continue
      }

      floodFillResults.push(pos)
      mincutSources.push(pos)

      floodFiilCosts.set(pos.x, pos.y, 255)
      pathFindingCosts.set(pos.x, pos.y, 255)

      // break after finding enough
      if (floodFillResults.length >= 79) {
        break
      }
    }

    // build roads around floodfilled structures

    for (const pos of floodFillResults) {
      // check up, down, left, right
      for (const vector of CROSS_VECTORS) {
        const x = pos.x + vector.x
        const y = pos.y + vector.y

        // build road if center is empty
        if (mod(x, y, 4) === CENTER_SUM && mod(x - y, 4) === CENTER_DIFF && floodFiilCosts.get(x, y) < 255) {
          const coord = { x, y }

          this.placeStructure(result, basePlanCosts, coord, STRUCTURE_ROAD)
          pathFindingCosts.set(x, y, 1)

          mincutSources.push(coord)
          continue
        }

        if (floodFiilCosts.get(x, y) < 255) {
          const coord = { x, y }

          this.placeStructure(result, basePlanCosts, coord, STRUCTURE_ROAD)
          pathFindingCosts.set(x, y, 1)

          mincutSources.push(coord)
        }
      }
    }

    const SECOND_SOURCE_LAB = [
      { x: 0, y: -1 },
      { x: 0, y: -2 },
      { x: 1, y: -1 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 0 },
    ]

    const sourceLabCosts = new PathFinder.CostMatrix()

    for (const pos of floodFillResults) {
      sourceLabCosts.set(pos.x, pos.y, 1)
    }

    let isLab = false
    outer: for (const firstSourceLab of floodFillResults) {
      let secondSourceLabCandidates = []

      SECOND_SOURCE_LAB.forEach((vector) => {
        const x = firstSourceLab.x + vector.x
        const y = firstSourceLab.y + vector.y
        if (x < 0 || x > 49 || y < 0 || y > 49) {
          return
        }

        if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
          secondSourceLabCandidates.push({ x, y })
        }
      })

      for (const secondSourceLab of secondSourceLabCandidates) {
        if (sourceLabCosts.get(secondSourceLab.x, secondSourceLab.y) < 1) {
          continue
        }
        let numReactionLab = 0
        const labPositions = [firstSourceLab, secondSourceLab]

        const firstSourceLabArea = coordUtils.getCoordsInRange(firstSourceLab, 2)

        for (const coord of firstSourceLabArea) {
          if (numReactionLab >= 8) {
            break
          }

          if (sourceLabCosts.get(coord.x, coord.y) < 1) {
            continue
          }

          if (coordUtils.getRange(coord, secondSourceLab) > 2) {
            continue
          }

          if (
            (coord.x === firstSourceLab.x && coord.y === firstSourceLab.y) ||
            (coord.x === secondSourceLab.x && coord.y === secondSourceLab.y)
          ) {
            continue
          }
          numReactionLab++
          labPositions.push(coord)
        }

        if (labPositions.length === 10) {
          isLab = true

          for (const pos of labPositions) {
            if ([firstSourceLab, secondSourceLab].find((coord) => coordUtils.getIsEqual(coord, pos))) {
              roomVisual.rect(pos.x - 0.5, pos.y - 0.5, 1, 1, {
                fill: colors.blue,
                opacity: 1,
                stroke: colors.green,
              })
            } else {
              roomVisual.rect(pos.x - 0.5, pos.y - 0.5, 1, 1, {
                fill: "transparent",
                stroke: colors.green,
              })
            }
            this.placeStructure(result, basePlanCosts, pos, STRUCTURE_LAB)
            floodFillResults = floodFillResults.filter((element) => element.x !== pos.x || element.y !== pos.y)
          }

          break outer
        }
      }
    }

    // return if we cannot find lab
    if (!isLab) {
      console.log("cannot find lab position")
      return
    }

    // place factory, nuker and observer
    const observerPos = floodFillResults.pop()
    this.placeStructure(result, basePlanCosts, observerPos, STRUCTURE_OBSERVER)

    const factoryPos = floodFillResults.shift()
    this.placeStructure(result, basePlanCosts, factoryPos, STRUCTURE_FACTORY)

    const nukerPos = floodFillResults.shift()
    this.placeStructure(result, basePlanCosts, nukerPos, STRUCTURE_NUKER)

    // place roads to controller upgrade area

    const upgradeSpotPos = new RoomPosition(upgradeSpotCoord.x, upgradeSpotCoord.y, roomName)

    const controllerPathSearch = PathFinder.search(
      startPos,
      { pos: upgradeSpotPos, range: 1 },
      {
        plainCost: 2,
        swampCost: 4,
        roomCallback: function (roomName) {
          return pathFindingCosts
        },
        maxOps: 10000,
        maxRooms: 1,
      },
    )

    if (controllerPathSearch.incomplete) {
      console.log("cannot find roads to controller")
      return
    }

    const controllerPath = controllerPathSearch.path

    for (const pos of controllerPath) {
      this.placeStructure(result, basePlanCosts, pos, STRUCTURE_ROAD, 3)
      pathFindingCosts.set(pos.x, pos.y, 1)
    }

    // roads to sources and minerals
    const sourceContainerCoordsPacked = {}

    const sourceIds = Object.keys(pointsOfInterest.sourceCoords)

    sourceIds.sort((a, b) => {
      const coordA = pointsOfInterest.sourceCoords[a]
      const posA = new RoomPosition(coordA.x, coordA.y, roomName)

      const coordB = pointsOfInterest.sourceCoords[b]
      const posB = new RoomPosition(coordB.x, coordB.y, roomName)

      const goals = [
        { pos: posA, range: 1 },
        { pos: posB, range: 1 },
      ]

      const search = PathFinder.search(startPos, goals, {
        plainCost: 2,
        swampCost: 4,
        roomCallback: function (roomName) {
          return pathFindingCosts
        },
        maxOps: 10000,
        maxRooms: 1,
      })

      const path = search.path

      const lastPos = path[path.length - 1]

      return coordUtils.getRange(lastPos, coordA) - coordUtils.getRange(lastPos, coordB)
    })

    for (const id of sourceIds) {
      const goalCoord = pointsOfInterest.sourceCoords[id]

      const goalPos = new RoomPosition(goalCoord.x, goalCoord.y, roomName)

      const sourcePathSearch = PathFinder.search(
        startPos,
        { pos: goalPos, range: 1 },
        {
          plainCost: 2,
          swampCost: 4,
          roomCallback: function (roomName) {
            return pathFindingCosts
          },
          maxOps: 10000,
          maxRooms: 1,
        },
      )

      if (sourcePathSearch.incomplete) {
        console.log("cannot find roads to source")
        return
      }

      const path = sourcePathSearch.path

      const containerPos = path.pop()

      this.placeStructure(result, basePlanCosts, containerPos, STRUCTURE_CONTAINER, 3)
      pathFindingCosts.set(containerPos.x, containerPos.y, 255)

      sourceContainerCoordsPacked[id] = coordUtils.packCoord(containerPos)

      for (const pos of path) {
        this.placeStructure(result, basePlanCosts, pos, STRUCTURE_ROAD, 3)
        pathFindingCosts.set(pos.x, pos.y, 1)
      }

      const areaNearContainer = coordUtils.getCoordsAtRange(containerPos, 1).filter((coord) => {
        if (terrain.get(coord.x, coord.y) === TERRAIN_MASK_WALL) {
          return false
        }
        if (pathFindingCosts.get(coord.x, coord.y) > 0) {
          return false
        }
        return true
      })

      const linkCoord = utils.getMinObject(areaNearContainer, (coord) => coordUtils.getRange(coord, storageLinkCoord))

      if (!linkCoord) {
        console.log(`cannot find position for source link`)
        return
      }

      this.placeStructure(result, basePlanCosts, linkCoord, STRUCTURE_LINK)
      pathFindingCosts.set(linkCoord.x, linkCoord.y, 255)

      links.sources[id] = coordUtils.packCoord(linkCoord)
    }

    for (const id in pointsOfInterest.mineralCoords) {
      const goalCoord = pointsOfInterest.mineralCoords[id]

      const goalPos = new RoomPosition(goalCoord.x, goalCoord.y, roomName)

      const mineralPathSearch = PathFinder.search(
        startPos,
        { pos: goalPos, range: 1 },
        {
          plainCost: 2,
          swampCost: 4,
          roomCallback: function (roomName) {
            return pathFindingCosts
          },
          maxOps: 10000,
          maxRooms: 1,
        },
      )

      if (mineralPathSearch.incomplete) {
        console.log("cannot find roads to source")
        return
      }

      const path = mineralPathSearch.path

      const containerPos = path.pop()

      sourceContainerCoordsPacked[id] = coordUtils.packCoord(containerPos)

      this.placeStructure(result, basePlanCosts, goalPos, STRUCTURE_EXTRACTOR)
      pathFindingCosts.set(goalPos.x, goalPos.y, 255)

      this.placeStructure(result, basePlanCosts, containerPos, STRUCTURE_CONTAINER, 6)
      pathFindingCosts.set(containerPos.x, containerPos.y, 255)

      for (const pos of path) {
        this.placeStructure(result, basePlanCosts, pos, STRUCTURE_ROAD, 6)
        pathFindingCosts.set(pos.x, pos.y, 1)
      }
    }

    // use mincut to find rampart positions

    const mincutSourcesWithDefensiveArea = []
    const costsForMincutSourceCheck = new PathFinder.CostMatrix()

    for (const coord of mincutSources) {
      mincutSourcesWithDefensiveArea.push(coord)

      costsForMincutSourceCheck.set(coord.x, coord.y, 1)

      const area = coordUtils.getCoordsInRange(coord, 3)

      for (const coordNear of area) {
        if (terrain.get(coordNear.x, coordNear.y) === TERRAIN_MASK_WALL) {
          continue
        }

        if (costsForMincutSourceCheck.get(coordNear.x, coordNear.y) > 0) {
          continue
        }

        mincutSourcesWithDefensiveArea.push(coordNear)
        costsForMincutSourceCheck.set(coordNear.x, coordNear.y, 1)
      }
    }

    const mincutResult = algorithm.mincutToExit(roomName, mincutSourcesWithDefensiveArea, exitCoords)

    const rampartPathingCosts = pathFindingCosts.clone()

    for (const outside of mincutResult.outsides) {
      rampartPathingCosts.set(outside.x, outside.y, 255)
    }

    for (const inside of mincutResult.insides) {
      if (inside.findInRange(mincutResult.outsides).length > 0) {
        if (rampartPathingCosts.get(inside.x, inside.y) < 100) {
          rampartPathingCosts.set(inside.x, inside.y, 100)
        }
      }
    }

    // get road to rampart
    for (const coord of mincutResult.cuts) {
      const rampartPathSearch = PathFinder.search(startPos, new RoomPosition(coord.x, coord.y, roomName), {
        plainCost: 5,
        swampCost: 5,
        roomCallback: function (roomName) {
          return rampartPathingCosts
        },
        maxOps: 10000,
        maxRooms: 1,
      })

      if (rampartPathSearch.incomplete) {
        console.log("cannot find path to rampart")
        continue
      }

      this.placeStructure(result, basePlanCosts, coord, STRUCTURE_RAMPART, RCL_TO_BUILD_RAMPART)

      const rampartPath = rampartPathSearch.path

      for (const pos of rampartPath) {
        if (coordUtils.getRange(pos, coord) < 3 && !this.readBasePlan(basePlanCosts, pos).isRampart) {
          this.placeStructure(result, basePlanCosts, pos, STRUCTURE_RAMPART, RCL_TO_BUILD_RAMPART)
        }

        this.placeStructure(result, basePlanCosts, pos, STRUCTURE_ROAD, RCL_TO_BUILD_RAMPART)
        pathFindingCosts.set(pos.x, pos.y, 1)
        rampartPathingCosts.set(pos.x, pos.y, 1)
      }
    }

    // place towers
    const rampartCoords = [...mincutResult.cuts]
    const towerCoords = []

    const firstTowerCoord = utils.getMinObject(floodFillResults, (coord) =>
      coordUtils.getAverageRange(coord, rampartCoords),
    )

    towerCoords.push(firstTowerCoord)

    this.placeStructure(result, basePlanCosts, firstTowerCoord, STRUCTURE_TOWER)
    pathFindingCosts.set(firstTowerCoord.x, firstTowerCoord.y, 255)

    floodFillResults = floodFillResults.filter((coord) => !coordUtils.getIsEqual(coord, firstTowerCoord))

    while (towerCoords.length < 6) {
      let weakestRampartCoord = undefined
      let minDamage = Infinity

      for (const rampartCoord of rampartCoords) {
        let damage = 0

        for (const coord of towerCoords) {
          const range = coordUtils.getRange(coord, rampartCoord)
          damage += utils.getTowerDamage(range)
        }

        if (damage < minDamage) {
          minDamage = damage
          weakestRampartCoord = rampartCoord
        }
      }

      if (weakestRampartCoord) {
        const range = Math.min(...floodFillResults.map((coord) => coordUtils.getRange(coord, weakestRampartCoord)))

        const candidates = floodFillResults.filter(
          (coord) => coordUtils.getRange(coord, weakestRampartCoord) <= range + 1,
        )

        const towerCoord = utils.getMinObject(candidates, (coord) => coordUtils.getAverageRange(coord, rampartCoords))

        towerCoords.push(towerCoord)

        this.placeStructure(result, basePlanCosts, towerCoord, STRUCTURE_TOWER)
        pathFindingCosts.set(towerCoord.x, towerCoord.y, 255)

        floodFillResults = floodFillResults.filter((pos) => !coordUtils.getIsEqual(pos, towerCoord))
      }
    }

    for (const coord of towerCoords.sort(
      (a, b) => coordUtils.getRange(a, startPos) - coordUtils.getRange(b, startPos),
    )) {
      this.placeStructure(result, basePlanCosts, coord, STRUCTURE_TOWER)
      roomVisual.rect(coord.x - 0.5, coord.y - 0.5, 1, 1, {
        fill: "transparent",
        stroke: colors.red,
      })
    }

    // place extensions

    for (const coord of floodFillResults) {
      this.placeStructure(result, basePlanCosts, coord, STRUCTURE_EXTENSION)
      pathFindingCosts.set(coord.x, coord.y, 255)
    }

    // pack basePlan
    const levelMap = new PathFinder.CostMatrix()

    for (const structureType of Object.keys(CONTROLLER_STRUCTURES)) {
      if (structureType === STRUCTURE_ROAD) {
        continue
      }

      if (structureType === STRUCTURE_CONTAINER) {
        continue
      }

      if (structureType === STRUCTURE_RAMPART) {
        continue
      }

      if (structureType === STRUCTURE_WALL) {
        continue
      }

      const structureTypePositions = result.structurePositions[structureType]

      const numStructureTypeByLevel = CONTROLLER_STRUCTURES[structureType]

      for (let level = 1; level <= 8; level++) {
        const numStructure = numStructureTypeByLevel[level] - (numStructureTypeByLevel[level - 1] || 0)
        if (numStructure > 0) {
          for (let j = 0; j < numStructure; j++) {
            const pos = structureTypePositions.shift()
            if (!pos) {
              continue
            }
            levelMap.set(pos.x, pos.y, level)
            result.structures[level].push(this.packStructure(pos, structureType))
          }
        }
      }
    }

    for (const pos of result.structurePositions[STRUCTURE_ROAD]) {
      const adjacents = coordUtils.getCoordsAtRange(pos, 1)
      let level = 8
      for (const adjacent of adjacents) {
        const adjacentLevel = levelMap.get(adjacent.x, adjacent.y) > 0 ? levelMap.get(adjacent.x, adjacent.y) : 8
        level = Math.min(level, adjacentLevel)
      }
      level = Math.max(3, level)
      result.structures[level].push(this.packStructure(pos, STRUCTURE_ROAD))
    }

    for (let level = 1; level <= 8; level++) {
      const structureSet = new Set(result.structures[level])
      for (let i = 1; i < level; i++) {
        for (const packed of result.structures[i]) {
          if (structureSet.has(packed)) {
            structureSet.delete(packed)
          }
        }
      }

      result.structures[level] = [...structureSet]
    }

    Memory.rooms[roomName] = Memory.rooms[roomName] || {}

    Memory.rooms[roomName].basePlan = {
      startCoord: coordUtils.packCoord(startPos),
      structures: result.structures,
      links,
      containers: sourceContainerCoordsPacked,
      costs: pathFindingCosts.serialize(),
    }

    const unpackedBasePlan = this.unpackBasePlan(Memory.rooms[roomName].basePlan)

    if (room) {
      room.heap.basePlan = unpackedBasePlan
    }

    return unpackedBasePlan
  },

  unpackBasePlan(packed) {
    const result = {}

    result.startCoord = coordUtils.unpackCoord(packed.startCoord)

    result.structures = new Array(9)

    for (let level = 1; level <= 8; level++) {
      const structures = []

      const packedStructures = packed.structures[level]

      for (const packedStructure of packedStructures) {
        structures.push(this.unpackStructure(packedStructure))
      }

      result.structures[level] = structures.sort(
        (a, b) => constant.BUILD_PRIORITY[a.structureType] - constant.BUILD_PRIORITY[b.structureType],
      )
    }

    result.links = {}

    result.links.sources = {}

    result.links.controller = coordUtils.unpackCoord(packed.links.controller)

    result.links.storage = coordUtils.unpackCoord(packed.links.storage)

    for (const id in packed.links.sources) {
      result.links.sources[id] = coordUtils.unpackCoord(packed.links.sources[id])
    }

    result.containers = {}

    for (const sourceId in packed.containers) {
      result.containers[sourceId] = coordUtils.unpackCoord(packed.containers[sourceId])
    }

    result.costs = PathFinder.CostMatrix.deserialize(packed)

    return result
  },

  visualizeBasePlan(roomName) {
    const basePlan = this.getBasePlan(roomName)

    const roomVisual = new RoomVisual(roomName)

    for (let level = 1; level <= 8; level++) {
      for (const unpacked of basePlan.structures[level]) {
        const coord = unpacked.coord
        const structureType = unpacked.structureType
        roomVisual.structure(coord.x, coord.y, structureType)
        roomVisual.text(level, coord.x, coord.y, { font: 0.5 })
      }
    }

    roomVisual.connectRoads()
  },

  /**
   * @param {object} result - Object to store result.
   * @property {object} result.structures - Object to store packed structure. Use when level is set.
   * @property {object} result.structurePositions - Object to store coord. Use when level is undefined
   * @param {object} coord
   * @param {string} structureType
   * @param {number} level
   */
  placeStructure(result, costs, coord, structureType, level) {
    this.recordBaseplan(costs, coord, structureType)
    if (level) {
      result.structures[level].push(this.packStructure(coord, structureType))
    } else {
      result.structurePositions[structureType].push(coord)
    }
  },

  recordBaseplan(costs, coord, structureType) {
    const code = BASE_PLAN_MASK[structureType]
    const valueBefore = costs.get(coord.x, coord.y)

    if (!OVERLAPPABLE_STRUCTURES.includes(structureType)) {
      costs.set(coord.x, coord.y, ((valueBefore >> 4) << 4) | code)
    } else {
      costs.set(coord.x, coord.y, code | valueBefore)
    }
  },

  readBasePlan(costs, coord) {
    const value = costs.get(coord.x, coord.y)

    const isRoad = !!(value & BASE_PLAN_MASK[STRUCTURE_ROAD])
    const isRampart = !!(value & BASE_PLAN_MASK[STRUCTURE_RAMPART])
    const structureValue = value & STRUCTURE_MASK
    const structureType = Object.keys(BASE_PLAN_MASK).find((key) => BASE_PLAN_MASK[key] === structureValue)

    return { structureType, isRoad, isRampart }
  },

  getStartPos(roomName, pointsOfInterest, exitCoords, visual = false) {
    const room = Game.rooms[roomName]

    const spawn = room.find(FIND_MY_SPAWNS)[0]

    if (spawn) {
      return new RoomPosition(spawn.pos.x + 1, spawn.pos.y + 1, roomName)
    }

    const { sourceCoords, controllerCoord } = pointsOfInterest

    const distanceTransform = algorithm.getDistanceTransform(roomName, { visual: false })

    const candidates = new MinHeap((pos) => {
      let result = coordUtils.getRange(controllerCoord, pos)
      result -= distanceTransform.costs.get(pos.x, pos.y)
      for (const sourceCoord of Object.values(sourceCoords)) {
        result += coordUtils.getRange(sourceCoord, pos) >> 2
      }
      if (visual) {
        new RoomVisual(roomName).text(result, pos.x, pos.y)
      }
      return result
    })

    for (let level = 3; distanceTransform.positions[level]; level++) {
      const positions = distanceTransform.positions[level]
      for (const pos of positions) {
        candidates.insert(pos)
      }
    }

    outer: while (candidates.getSize() > 0) {
      const candidate = candidates.remove()
      if (coordUtils.getRange(candidate, controllerCoord) < 5) {
        continue
      }
      for (const sourcePos of Object.values(sourceCoords)) {
        if (candidate.getRangeTo(sourcePos) < 5) {
          continue outer
        }
      }

      if (exitCoords.some((coord) => coordUtils.getRange(candidate, coord) < 6)) {
        continue
      }

      if (this.checkClusterAnchor(candidate)) {
        new RoomVisual(roomName).circle(candidate, { fill: "green", radius: 1 })
        return candidate
      }
    }
  },

  getPointsOfInterest(room) {
    let sourceCoords = {}
    let mineralCoords = {}
    let controllerCoord

    // get source, mineral, controller position

    if (room) {
      room.find(FIND_SOURCES).forEach((source) => {
        sourceCoords[source.id] = source.pos
      })
      room.find(FIND_MINERALS).forEach((mineral) => {
        mineralCoords[mineral.id] = mineral.pos
      })
      controllerCoord = room.controller.pos
    }

    return { sourceCoords, mineralCoords, controllerCoord }
  },

  checkClusterAnchor(centerPos, costs) {
    if (!costs) {
      costs = new PathFinder.CostMatrix()
    }

    const terrain = Game.map.getRoomTerrain(centerPos.roomName)

    for (const vector of CLUSTER_STAMP) {
      const x = centerPos.x + vector.x
      const y = centerPos.y + vector.y

      if (x < 0 || x > 49 || y < 0 || y > 49) {
        return false
      }

      if (costs.get(x, y) > 0) {
        return false
      }

      if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
        return false
      }
    }

    return true
  },

  packStructure(coord, structureType) {
    return 33 * coordUtils.packCoord(coord) + BASE_PLAN_MASK[structureType]
  },

  unpackStructure(packed) {
    const structureValue = packed % 33
    const structureType = Object.keys(BASE_PLAN_MASK).find((key) => BASE_PLAN_MASK[key] === structureValue)
    const packedCoord = (packed - structureValue) / 33
    const coord = coordUtils.unpackCoord(packedCoord)
    return { coord, structureType }
  },
}

module.exports = basePlanner
