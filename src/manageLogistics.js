const config = require("./config")
const coordUtils = require("./coordUtils")
const creepUtils = require("./creepUtils")
const roomUtils = require("./roomUtils")
const screepsProfiler = require("./screeps-profiler")
const spawnUtils = require("./spawnUtils")
const MinHeap = require("./util_min_heap")
const { colors } = require("./util_roomVisual_prototype")
const utils = require("./utils")

const ENERGY_FILL_PRIORITY = {
  extension: 1,
  spawn: 1,
  lab: 1,
  tower: 1,
  builder: 2,
  container: 3,
  upgrader: 4,
  terminal: 5,
  factory: 6,
  nuker: 7,
  storage: 8,
}

const STRUCTURE_TYPES_TO_FILL = [STRUCTURE_TOWER, STRUCTURE_STORAGE, STRUCTURE_LAB]

const THRESHOLD_TO_FILL = {
  [STRUCTURE_TOWER]: 400,
  [STRUCTURE_LAB]: 500,
}

/**
 *
 * @param {Room} room
 * @param {[Creep]} haulers
 * @param {[Creep]} creepsToFill
 * @returns
 */
let manageLogistics = function (room, haulers, creepsToFill = []) {
  const requests = getFillRequests(room, creepsToFill)

  const storage = room.storage

  if (storage) {
    const energyLevel = roomUtils.getEnergyLevel(room)

    const startPos = roomUtils.getStartPos(room)
    const x = startPos.x
    const y = startPos.y + 2.5

    new RoomVisual(room.name).rect(x - 2, y - 0.25, 4, 0.5, { stroke: colors.green })

    const measure = utils.clamp((energyLevel - 100) / 50, -2, 2)

    new RoomVisual(room.name).rect(x - 2, y - 0.25, 2 + measure, 0.5, {
      fill: colors.green,
      opacity: 1,
    })

    new RoomVisual(room.name).line(x, y + 0.25, x, y - 0.25, {
      color: colors.gray,
      lineStyle: "dashed",
      opacity: 0.5,
    })

    new RoomVisual(room.name).text("🔋", x - 1.5, y + 0.25)

    new RoomVisual(room.name).text("🔻", x, y - 0.35, { font: 0.5 })
  }

  if (room.controller.level >= 4) {
    const porters = roomUtils.getCreepsByRole(room, "porter")

    const energySource = getEnergySource(room, storage)

    porters.forEach((creep) => {
      if (creep.spawning) {
        return
      }

      runPorter(creep, energySource)

      if (creep.memory.supplying) {
        haulers.push(creep)
      }
    })

    if (energySource && room.memory.canSpawn) {
      let numCarry = 0

      porters.forEach((creep) => {
        if ((creep.ticksToLive || CREEP_LIFE_TIME) > creep.body.length * CREEP_SPAWN_TIME) {
          numCarry += creep.getActiveBodyparts(CARRY)
        }
      })

      let maxCarry = roomUtils.getStructuresByType(room, STRUCTURE_SPAWN).length * 15 // believe my math

      if (room.storage && !roomUtils.getControllerLink(room)) {
        maxCarry += room.memory.controllerNumCarry
      }

      if (numCarry < maxCarry) {
        const idler = roomUtils.pullIdler(room, (creep) => {
          for (const part of creep.body) {
            let isMove = false
            let isCarry = false
            if (part.type === MOVE) {
              isMove = true
            } else if (part.type === CARRY) {
              isCarry = true
            } else {
              return false
            }
          }

          return isMove && isCarry
        })

        if (idler) {
          idler.memory.role = "porter"
        } else {
          const body = spawnUtils.getHaulerBody(room.energyAvailable, true)
          global.requestCreep(room, body, "porter")
        }
      }
    }
  }

  const idlers = []

  if (Object.keys(requests).length === 0) {
    return
  }

  for (const hauler of haulers) {
    if (!hauler.memory.startSupplying) {
      continue
    }

    hauler.amount = hauler.store.getUsedCapacity(RESOURCE_ENERGY)

    const targetRequest = hauler.heap.targetRequest ? requests[hauler.heap.targetRequest.id] : undefined

    if (!targetRequest) {
      hauler.heap.targetRequest = undefined
      idlers.push(hauler)
      continue
    }

    targetRequest.amount -= hauler.amount

    if (runSupplier(hauler, targetRequest) === OK) {
      hauler.amount -= Math.min(hauler.amount, targetRequest.requestedAmount)
      hauler.heap.targetRequest = undefined
      if (hauler.amount > 0) {
        idlers.push(hauler)
      }
    }
  }

  if (idlers.length === 0) {
    return
  }

  const porterPriorityThreshold = room.storage
    ? ENERGY_FILL_PRIORITY[STRUCTURE_STORAGE]
    : ENERGY_FILL_PRIORITY[STRUCTURE_CONTAINER]

  galeShapley(requests, idlers, porterPriorityThreshold)

  const controllerLinkPos = roomUtils.getControllerLinkPos(room)

  for (const hauler of idlers) {
    if (hauler.heap.targetRequest) {
      if (runSupplier(hauler, hauler.heap.targetRequest) === OK) {
        hauler.heap.targetRequest = undefined
      }
      continue
    }

    if (hauler.memory.role === "porter") {
      if (hauler.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        pretickPorter(hauler, true)
      }
      continue
    }

    roomUtils.addSpawnBalance(room)
    hauler.say("💬", true)

    if (roomUtils.getControllerLink(room)) {
      continue
    }

    if (hauler.pos.getRangeTo(controllerLinkPos) > 0) {
      creepUtils.moveCreep(hauler, { pos: controllerLinkPos })
      return
    }

    hauler.drop(RESOURCE_ENERGY)
  }
}

function runPorter(creep, energySource) {
  pretickPorter(creep)

  if (creep.memory.supplying) {
    return
  }

  if (creep.ticksToLive < 20) {
    return
  }

  if (!energySource) {
    return
  }

  if (creep.pos.getRangeTo(energySource) > 1) {
    creepUtils.moveCreep(creep, { pos: energySource.pos, range: 1 })
    return
  }

  creep.withdraw(energySource, RESOURCE_ENERGY)
}

function pretickPorter(creep, force = false) {
  if (creep.memory.supplying && (force || creep.store.getUsedCapacity() === 0)) {
    creep.memory.supplying = false
    creep.memory.startSupplying = false
  } else if (!creep.memory.supplying && (force || creep.store.getFreeCapacity() === 0)) {
    creep.memory.supplying = true
    creep.memory.startSupplying = true
  }
}

function getEnergySource(room, storage) {
  if (storage && storage.store.getUsedCapacity(RESOURCE_ENERGY)) {
    return storage
  }

  const terminal = room.terminal

  if (terminal && terminal.store.getUsedCapacity(RESOURCE_ENERGY)) {
    return terminal
  }
}

function runSupplier(hauler, request) {
  const target = request.target

  if (coordUtils.getRange(hauler.pos, target.pos) > 1) {
    creepUtils.moveCreep(hauler, { pos: target.pos, range: 1 })
    return
  }

  return hauler.transfer(target, RESOURCE_ENERGY)
}

/**
 *
 * @param {[Request]} requests
 * @param {[Creep]} haulers
 */
function galeShapley(requests, haulers, porterPriorityThreshold) {
  const requestArray = Object.values(requests)

  for (const request of requestArray) {
    request.haulers = new MinHeap((hauler) => coordUtils.getRange(request.target.pos, hauler.pos))

    for (const hauler of haulers) {
      if (hauler.memory.role === "porter" && hauler.ticksToLive >= 20 && request.priority >= porterPriorityThreshold) {
        continue
      }

      request.haulers.insert(hauler)
    }
  }

  while (true) {
    const freeRequests = requestArray.filter((request) => {
      if (request.amount <= 0) {
        return false
      }

      if (request.haulers.getSize() === 0) {
        return false
      }

      return true
    })

    if (freeRequests.length === 0) {
      break
    }

    for (const request of freeRequests) {
      const bestHauler = request.haulers.remove()
      const requestBefore = bestHauler.heap.targetRequest
      // target creep has no request. match!
      if (!requestBefore) {
        request.amount -= bestHauler.amount

        if (request.useRate) {
          request.amount += request.useRate * coordUtils.getRange(request.target.pos, bestHauler.pos)
        }

        bestHauler.heap.targetRequest = request
        continue
      }

      // target creep has match. let's compare

      if (requestBefore.priority < request.priority) {
        // priority is low. give up
        continue
      }

      if (
        requestBefore.priority === request.priority &&
        coordUtils.getRange(bestHauler.pos, requestBefore.target.pos) <=
          coordUtils.getRange(bestHauler.pos, request.target.pos) // same priority but not closer
      ) {
        continue
      }

      // high priority or closer. take this creep.
      requestBefore.amount += bestHauler.amount
      if (requestBefore.useRate) {
        requestBefore.amount -= requestBefore.useRate * coordUtils.getRange(requestBefore.target.pos, bestHauler.pos)
      }

      request.amount -= bestHauler.amount
      if (request.useRate) {
        request.amount += request.useRate * coordUtils.getRange(request.target.pos, bestHauler.pos)
      }

      bestHauler.heap.targetRequest = request
    }
  }
}

function getFillRequests(room, creepsToFill) {
  const result = {}

  if (room.energyAvailable < room.energyCapacityAvailable) {
    getFillRequestsByType(room, STRUCTURE_SPAWN).forEach((request) => (result[request.id] = request))
    getFillRequestsByType(room, STRUCTURE_EXTENSION).forEach((request) => (result[request.id] = request))
  }

  for (const structureType of STRUCTURE_TYPES_TO_FILL) {
    getFillRequestsByType(room, structureType).forEach((request) => (result[request.id] = request))
  }

  const controllerContainer = roomUtils.getControllerContainer(room)

  if (controllerContainer) {
    new RoomVisual(room.name).text(
      `🟡${controllerContainer.store.getUsedCapacity(RESOURCE_ENERGY)}`,
      controllerContainer.pos.x + 0.5,
      controllerContainer.pos.y,
      {
        font: 0.5,
        align: "left",
      },
    )

    const request = new Request(controllerContainer)
    if (request.amount > 0) {
      result[controllerContainer.id] = request
    }
  }

  creepsToFill.forEach((creep) => {
    const request = new Request(creep)
    result[request.id] = request
  })

  return result
}

function getFillRequestsByType(room, structureType) {
  const result = []

  const structures = roomUtils.getStructuresByType(room, structureType)

  const threshold = THRESHOLD_TO_FILL[structureType] || 0

  structures.forEach((structure) => {
    const request = new Request(structure)

    if (request.amount > threshold) {
      result.push(request)
    }
  })

  return result
}

function Request(target) {
  if (target instanceof Structure) {
    this.priority = ENERGY_FILL_PRIORITY[target.structureType]
  } else if (target instanceof Creep) {
    this.priority = ENERGY_FILL_PRIORITY[target.memory.role]
  }

  const amount = target.store.getFreeCapacity(RESOURCE_ENERGY)

  this.amount = amount

  this.requestedAmount = amount

  if (target instanceof Creep && this.amount / target.store.getCapacity() > 0.5) {
    this.priority -= 0.5
    this.useRate = target.useRate || 0
  }

  this.target = target

  this.id = target.id
}

if (config.test.profiler) {
  manageLogistics = screepsProfiler.registerFN(manageLogistics, "manageLogistics")
}

module.exports = manageLogistics
