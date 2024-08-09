const config = require("./config")
const constant = require("./constant")
const coordUtils = require("./coordUtils")
const pathUtils = require("./pathUtils")
const screepsProfiler = require("./screeps-profiler")
const utils = require("./utils")

Memory.creeps = Memory.creeps || {}

const COMBAT_PARTS_AMOUNT = {
  [ATTACK]: ATTACK_POWER,
  [RANGED_ATTACK]: RANGED_ATTACK_POWER,
  [HEAL]: HEAL_POWER,
}

const creepUtils = {
  /**
   *
   * @param {Creep} creep
   */
  setIdler(creep) {
    creep.memory.role = undefined
  },

  /**
   *
   * @param {Creep} creep
   */
  getCombatStat(creep) {
    let ranged = 0
    let attack = 0
    let heal = 0
    for (const part of creep.body) {
      let amount = COMBAT_PARTS_AMOUNT[part.type]

      if (!amount) {
        continue
      }

      if (part.boost) {
        amount * BOOSTS[part.type][part.boost][part.type]
      }

      if (part.type === ATTACK) {
        attack += amount
      } else if (part.type === RANGED_ATTACK) {
        ranged += amount
      } else if (part.type === HEAL) {
        heal += amount
      }
    }

    return { ranged, attack, heal }
  },

  /**
   * Fill certain area with certain creeps.
   * @param {[RoomPosition]} area
   * @param {[Creep]} creeps
   */
  fillSpaceWithCreeps(area, creeps, roomCosts) {
    const costs = new PathFinder.CostMatrix()

    const adjacentCreeps = []

    creeps.forEach((creep) => {
      costs.set(creep.pos.x, creep.pos.y, 1)

      const range = Math.min(...area.map((pos) => pos.getRangeTo(creep)))

      if (range > 1) {
        creepUtils.moveCreep(
          creep,
          area.map((pos) => {
            return { pos, range: 1 }
          }),
        )
        return
      }

      if (range === 1) {
        adjacentCreeps.push(creep)
        return
      }
    })

    if (adjacentCreeps.length === 0) {
      return OK
    }

    const emptyPositions = area.filter((tile) => costs.get(tile.x, tile.y) === 0 && roomCosts.get(tile.x, tile.y) < 255)

    if (emptyPositions.length === 0) {
      return OK
    }

    const goals = emptyPositions.map((pos) => {
      return { pos, range: 0 }
    })

    for (const creep of adjacentCreeps) {
      const search = PathFinder.search(creep.pos, goals, {
        roomCallback: () => costs,
        plainCost: 255,
        swampCost: 255,
        maxOps: 100,
      })

      const path = search.path

      path.unshift(creep.pos)

      for (let i = 0; i < path.length - 1; i++) {
        const now = path[i]

        const goal = path[i + 1]

        const creep = now.lookFor(LOOK_CREEPS).find((creep) => creep.my)

        if (creep) {
          creepUtils.moveCreep(creep, { pos: goal, range: 0 })
          costs.set(creep.pos.x, creep.pos.y, 0)
        }
      }
    }
  },

  isAttacker(creep) {
    return creep.body.some((part) => constant.ATTACKER_BODY_TYPES.includes(part.type))
  },

  /**
   *
   * @param {Creep} creep
   * @returns
   */
  isCombatant(creep) {
    return creep.body.some((part) => constant.COMBATANT_BODY_TYPES.includes(part.type))
  },

  /**
   *
   * @param {Creep} creep
   * @returns
   */
  isThreat(creep) {
    return creep.body.some((part) => constant.THREAT_BODY_TYPES.includes(part.type))
  },

  /**
   *
   * @param {Creep} creep
   * @returns {boolean}
   */
  isAlly(creep) {
    return config.diplomacy.allies.includes(creep.owner.username)
  },

  getActiveBodypartsFromArray(array, type) {
    let result = 0

    for (const creep of array) {
      result += creep.getActiveBodyparts(type)
    }

    return result
  },

  /**
   *
   * @param {Creep} creep
   * @param {[RoomPosition]} path
   * @param {object} opts
   * @returns
   */
  moveCreepByPath(creep, path, opts) {
    if (followByPath(creep, path, opts) === OK) {
      return OK
    }

    const goals = path.map((pos) => {
      return { pos, range: 0 }
    })

    return this.moveCreep(creep, goals, opts)
  },

  /**
   *@typedef {object} goal
   *@property {RoomPosition} pos
   *@property {number} range
   */

  /**
   *
   * @param {Creep} creep
   * @param {[goal]} goals
   * @param {object} opts
   * @returns
   */
  moveCreep(creep, goals, opts = {}) {
    if (creep.spawning) {
      return
    }

    if (creep.fatigue || creep.getActiveBodyparts(MOVE) === 0) {
      return
    }

    opts = { ...config.movement.defaultOpts, ...opts }

    const moveCost = this.getMoveCost(creep)

    const plainCost = opts.plainCost || Math.min(2, Math.max(1, Math.ceil(2 * Number(moveCost))))

    const swampCost = opts.swampCost || Math.min(10, Math.max(1, Math.ceil(10 * Number(moveCost))))

    opts.plainCost = plainCost

    opts.swampCost = swampCost

    goals = normalizeGoals(goals)

    if (config.test.visualizeGoal) {
      const goalPos = goals[0].pos
      if (creep.room.name === goalPos.roomName) {
        new RoomVisual(goalPos.roomName).line(creep.pos, goalPos)
      }
    }

    if (!opts.flee && goals.some((goal) => creep.pos.getRangeTo(goal.pos) <= goal.range)) {
      return
    } else if (opts.flee && !goals.some((goal) => creep.pos.getRangeTo(goal.pos) < goal.range)) {
      return
    }

    if (creep.heap.lastPos && creep.pos.isEqualTo(creep.heap.lastPos)) {
      creep.heap._stuck = creep.heap._stuck || 0
      creep.heap._stuck++

      if (creep.heap._stuck > 1) {
        creep.say(`😣${creep.heap._stuck}`, true)
      }

      if (creep.heap._stuck >= opts.repathIfStuck) {
        creep.say("🧐", true)

        opts.avoidCreeps = Math.random() > 0.5

        creep.heap._path = undefined
      }
    } else {
      creep.heap._stuck = 0
    }

    creep.heap.lastPos = creep.pos

    if (
      !opts.flee &&
      creep.heap._path &&
      pathUtils.isValidPath(creep.heap._path, goals) &&
      followByPath(creep, creep.heap._path) === OK
    ) {
      if (opts.visualizePath) {
        utils.visualizePath(creep.heap._path)
      }
      return
    }

    creep.heap._path = pathUtils.findPath(creep.pos, goals, opts)

    if (!creep.heap._path) {
      creep.say("😵", true)
      console.log(`${creep.name} cannot find path from ${creep.pos} to ${goals[0].pos}`)
      return ERR_NO_PATH
    }

    followByPath(creep, creep.heap._path)
  },

  getMoveCost(creep) {
    let burden = 0
    let move = 0
    let usedCapacity = creep.store.getUsedCapacity()
    for (const part of creep.body) {
      if (part.type === MOVE) {
        if (part.hits === 0) {
          continue
        }
        move += part.boost === "XZHO2" ? 8 : part.boost === "ZHO2" ? 6 : part.boost === "ZO" ? 4 : 2
        continue
      }
      if (part.type === CARRY) {
        if (usedCapacity > 0) {
          burden += 1
          usedCapacity -= 50
          continue
        }
        continue
      }
      burden += 1
      continue
    }
    return burden / move
  },
}

function normalizeGoals(goals) {
  goals = Array.isArray(goals) ? goals : [goals]
  const result = []
  for (let i = 0; i < goals.length; i++) {
    const goal = goals[i]

    if (!goal) {
      continue
    }

    const pos = goal.pos || goal
    if (!pos instanceof RoomPosition) {
      continue
    }

    const range = goal.range || 0
    if (isNaN(range)) {
      throw new Error(`goal range ${goal.range} of ${goal} of ${goals} is NaN`)
    }

    result.push({ pos, range })
  }
  return result
}

/**
 * move creep by path
 * @param {Creep} creep
 * @param {[RoomPosition]} path
 * @param {object} opts
 * @param {boolean} opts.reverse
 * @returns
 */
function followByPath(creep, path, opts = {}) {
  let index = undefined

  const delta = opts.reverse ? -1 : 1

  const cachedIndex = creep.heap._pathIndex

  if (cachedIndex !== undefined) {
    for (const i of [cachedIndex, cachedIndex - delta, cachedIndex + delta]) {
      if (path[i] && creep.pos.isEqualTo(path[i])) {
        index = i
        break
      }
    }
  }

  if (index === undefined) {
    index = _.findIndex(path, (i) => i.isEqualTo(creep.pos))
  }

  if (index === -1) {
    const startIndex = opts.reverse ? path.length - 1 : 0
    if (!creep.pos.isNearTo(path[startIndex])) {
      return ERR_NOT_FOUND
    }
    index = opts.reverse ? path.length : -1
  }

  index += delta

  if (index >= path.length || index < 0) {
    return ERR_NOT_FOUND
  }

  const nextPos = path[index]

  creep.registerMove(nextPos)

  creep.heap._pathIndex = index

  return OK
}

if (config.test.profiler) {
  screepsProfiler.registerObject(creepUtils, "creepUtils")
}

module.exports = creepUtils
