const config = require("./config")
const screepsProfiler = require("./screeps-profiler")

const blinkyBodyParams = {
  260: [1, 1, 0],
  550: [0, 1, 1],
  760: [1, 2, 1],
  1300: [0, 5, 1],
  1800: [0, 6, 2],
  2300: [0, 7, 3],
  5600: [0, 19, 6],
}

const spawnUtils = {
  parseBody(str) {
    const shorts = {
      m: "move",
      w: "work",
      c: "carry",
      a: "attack",
      r: "ranged_attack",
      h: "heal",
      t: "tough",
      cl: "claim",
    }
    let res = []
    for (let i = 0; i < str.length; ) {
      let count = str[i++]
      if (str[i] >= "0" && str[i] <= "9") {
        count += str[i++]
      }
      let label = str[i++]
      if (str[i] === "l") {
        label += str[i++]
      }
      while (count-- > 0) {
        res.push(shorts[label])
      }
    }
    return res
  },

  getBlinkyBody(energyCapacity, options = {}) {
    const { frontMove, strengthNeeded } = options

    let currentParams

    for (const cost of Object.keys(blinkyBodyParams)) {
      if (cost > energyCapacity) {
        break
      }

      currentParams = blinkyBodyParams[cost]

      if (
        strengthNeeded &&
        strengthNeeded.totalAttack + strengthNeeded.totalRanged < currentParams[1] * RANGED_ATTACK_POWER &&
        strengthNeeded.totalHeal < currentParams[2] * HEAL_POWER
      ) {
        break
      }
    }

    if (currentParams) {
      return blinkyBodyMaker(...currentParams, frontMove)
    }
  },

  /**
   *
   * @param {Room} room
   */
  getBuilderMaxNumWork(room) {
    if (room._builderMaxNumWork) {
      room._builderMaxNumWork
    }

    const body = this.getBuilderBody(room.energyCapacityAvailable)

    return (room._builderMaxNumWork = body.filter((part) => part === WORK).length)
  },

  getBuilderBody(energyCapacity, maxWork) {
    let cost = 200
    let work = 1
    let move = 1
    let carry = 1

    while (energyCapacity > cost && work + move + carry < MAX_CREEP_SIZE) {
      if ((move === 0 || (work + carry) / move >= 2) && energyCapacity >= cost + BODYPART_COST[MOVE]) {
        move++
        cost += BODYPART_COST[MOVE]
        continue
      }

      if ((carry === 0 || carry / work <= 2) && energyCapacity >= cost + BODYPART_COST[CARRY]) {
        carry++
        cost += BODYPART_COST[CARRY]
        continue
      }

      if (maxWork && work >= maxWork) {
        break
      }

      if (energyCapacity >= cost + BODYPART_COST[WORK]) {
        work++
        cost += BODYPART_COST[WORK]
        continue
      }
      break
    }

    const body = []

    for (let i = 0; i < work - 1; i++) {
      body.push(WORK)
    }

    for (let i = 0; i < carry; i++) {
      body.push(CARRY)
    }

    for (let i = 0; i < move - 1; i++) {
      body.push(MOVE)
    }

    body.push(WORK, MOVE)

    return body
  },

  /**
   *
   * @param {Room} room
   */
  getUpgraderMaxNumWork(room) {
    if (room._upgraderMaxNumWork) {
      room._upgraderMaxNumWork
    }

    const body = this.getUpgraderBody(room.energyCapacityAvailable)

    return (room._upgraderMaxNumWork = body.filter((part) => part === WORK).length)
  },

  getUpgraderBody(energyCapacity, maxWork) {
    let cost = 50
    let work = 0
    let move = 0
    let carry = 1
    while (energyCapacity > cost) {
      if ((CARRY_CAPACITY * carry) / work < 2 && energyCapacity >= cost + BODYPART_COST[CARRY]) {
        if (work + move + carry + 1 > MAX_CREEP_SIZE) {
          break
        }
        carry++
        cost += BODYPART_COST[CARRY]
        continue
      }

      if ((move === 0 || work / move >= 4) && energyCapacity >= cost + BODYPART_COST[MOVE]) {
        if (work + move + carry + 1 > MAX_CREEP_SIZE) {
          break
        }
        move++
        cost += BODYPART_COST[MOVE]
        continue
      }

      if (maxWork && work >= maxWork) {
        break
      }

      if (energyCapacity >= cost + BODYPART_COST[WORK]) {
        if (work + move + carry + 1 > MAX_CREEP_SIZE) {
          break
        }
        work++
        cost += BODYPART_COST[WORK]
        continue
      }
      break
    }

    const body = []

    if (work === 0) {
      return { body, numWork: work, cost }
    }

    for (let i = 0; i < work - 1; i++) {
      body.push(WORK)
    }

    for (let i = 0; i < carry; i++) {
      body.push(CARRY)
    }

    for (let i = 0; i < move; i++) {
      body.push(MOVE)
    }

    body.push(WORK)

    return body
  },

  getHaulerBody(energyCapacity, forRoad = false) {
    let iterationCost

    let maxIteration

    let bodyComponent

    if (forRoad) {
      iterationCost = 150
      maxIteration = 16
      bodyComponent = [CARRY, CARRY, MOVE]
    } else {
      iterationCost = 100
      maxIteration = 25
      bodyComponent = [CARRY, MOVE]
    }

    const numIteration = Math.min(Math.floor(energyCapacity / iterationCost), maxIteration)

    const body = []

    for (let i = 0; i < numIteration; i++) {
      body.push(...bodyComponent)
    }

    return body
  },

  getMinerBody(energyCapacity, maxWork, needCarry) {
    let cost = 0
    let work = 0
    let move = 0
    let carry = 0

    move += 1
    cost += BODYPART_COST[MOVE]

    if (needCarry) {
      carry += 1
      cost += BODYPART_COST[CARRY]
    }

    while (cost < energyCapacity && work + move + carry < MAX_CREEP_SIZE) {
      if (work < 5 && work < maxWork && energyCapacity >= cost + BODYPART_COST[WORK]) {
        work++
        cost += BODYPART_COST[WORK]
        continue
      }

      if ((move === 0 || work / move > 2) && energyCapacity >= cost + BODYPART_COST[MOVE]) {
        move++
        cost += BODYPART_COST[MOVE]
        continue
      }

      if (work >= 5 && carry < 1 && energyCapacity >= cost + BODYPART_COST[CARRY]) {
        carry++
        cost += BODYPART_COST[CARRY]
        continue
      }

      if (maxWork && work >= maxWork) {
        break
      }

      if (energyCapacity >= cost + BODYPART_COST[WORK]) {
        work++
        cost += BODYPART_COST[WORK]
        continue
      }

      break
    }

    const body = []

    for (let i = 0; i < work - 1; i++) {
      body.push(WORK)
    }

    for (let i = 0; i < carry; i++) {
      body.push(CARRY)
    }

    for (let i = 0; i < move; i++) {
      body.push(MOVE)
    }

    body.push(WORK)

    return body
  },
}

function blinkyBodyMaker(t, r, h, frontMove = false) {
  const result = []
  for (let i = 0; i < t; i++) {
    result.push(TOUGH)
  }

  if (frontMove) {
    for (let i = 0; i < r + h + t; i++) {
      result.push(MOVE)
    }
  }

  for (let i = 0; i < r; i++) {
    result.push(RANGED_ATTACK)
  }

  if (!frontMove) {
    for (let i = 0; i < r + h + t; i++) {
      result.push(MOVE)
    }
  }

  for (let i = 0; i < h; i++) {
    result.push(HEAL)
  }
  return result
}

if (config.test.profiler) {
  screepsProfiler.registerObject(spawnUtils, "spawnUtils")
}

module.exports = spawnUtils
