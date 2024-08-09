const config = require("./config")
const dataStorage = require("./dataStorage")
const roomUtils = require("./roomUtils")
const screepsProfiler = require("./screeps-profiler")
const { colors } = require("./util_roomVisual_prototype")

const roles = {
  tester: "t",

  minerUrgent: "m",
  haulerUrgent: "h",

  distributor: "d",

  porter: "p",

  blinky: "bl",
  keeperKiller: "k",
  coreAttacker: "c",

  builderUrgent: "b",
  upgraderUrgent: "u",

  reserver: "r",
  miner: "m",
  sourceBuilder: "sb",
  hauler: "h",
  sourceRepairer: "sr",

  scouter: "s",

  rampartRepairer: "rr",

  builder: "b",
  upgrader: "u",
}

const DEFAULT_SPAWN_PRIORITY = Object.keys(roles)
/**
 * @typedef {object} spawnRequestOptions
 * @property {object} memory - (optional) creep memory
 * @property {string} name - (optional) creep name
 * @property {roomName} roomName - (optional) roomName to belong
 * @property {object} mission - (optional) mission id to belong
 * @property {number} priority - (optional) priority
 * @property {boolean} urgent - (optional) urgent
 */

/**
 *
 * @param {Room} room - room to spawn creep
 * @param {Array} body - creep body
 * @param {string} role - creep role
 * @param {spawnRequestOptions} options - {memory, name, roomName, mission, priority, urgent}
 */
global.requestCreep = function (room, body, role, options) {
  const request = new SpawnRequest(room, body, role, options)
  room.spawnQueue.insert(request)
}

const spawnManager = {
  preTick() {
    for (const room of dataStorage.temp.myRooms) {
      const spawns = roomUtils.getStructuresByType(room, STRUCTURE_SPAWN)

      room.freeSpawns = []
      room.memory.canSpawn = false

      room.memory.spawnBalance = room.memory.spawnBalance || 0

      for (const spawn of spawns) {
        if (!spawn.spawning) {
          room.freeSpawns.push(spawn)
          room.memory.canSpawn = true
          continue
        }

        if (spawn.spawning.remainingTime === 0) {
          for (const creep of spawn.pos.findInRange(FIND_MY_CREEPS, 1)) {
            if (creep.memory.role === "distributor") {
              continue
            }
            const randomDirection = Math.floor(Math.random() * 8) + 1
            creep.registerMove(randomDirection)
          }
        }

        const creep = Game.creeps[spawn.spawning.name]

        new RoomVisual(room.name).text(`🐣${creep.memory.role}`, spawn.pos.x, spawn.pos.y - 1, {
          font: 0.5,
        })
      }
    }
  },

  run() {
    for (const room of dataStorage.temp.myRooms) {
      manageSpawn(room)
    }
  },
}

const ratio = Math.pow(2, -1 / 50)

/**
 *
 * @param {Room} room
 */
function manageSpawn(room) {
  if (!room.storage) {
    const startPos = roomUtils.getStartPos(room)
    const x = startPos.x
    const y = startPos.y - 3.5

    new RoomVisual(room.name).rect(x - 3, y - 0.25, 6, 1, { stroke: colors.dark })

    new RoomVisual(room.name).line(x - 2, y + 0.75, x - 2, y - 0.25, {
      color: colors.gray,
      opacity: 1,
    })

    new RoomVisual(room.name).line(x + 2, y + 0.75, x + 2, y - 0.25, {
      color: colors.gray,
      opacity: 1,
    })

    new RoomVisual(room.name).text("🔼", x + 2.5, y + 0.5)

    new RoomVisual(room.name).text("🟡", x - 2.5, y + 0.5)

    new RoomVisual(room.name).text("🔻", x + 1, y - 0.35, { font: 0.5 })

    new RoomVisual(room.name).line(x, y + 0.75, x, y - 0.25, {
      color: colors.gray,
      lineStyle: "dashed",
      opacity: 1,
    })

    const spawnBalance = room.memory.spawnBalance * 2

    new RoomVisual(room.name).line(x + spawnBalance, y + 0.75, x + spawnBalance, y - 0.25, {
      color: colors.red,
      opacity: 1,
    })
  }

  room.memory.spawnBalance = room.memory.spawnBalance * ratio

  const queue = room.spawnQueue
  while (queue.getSize() > 0 && room.freeSpawns.length > 0) {
    const nextRequest = queue.remove()
    const spawn = room.freeSpawns.pop()
    if (spawnByRequest(spawn, nextRequest) !== OK) {
      break
    }
  }
}

/**
 *
 * @param {StructureSpawn} spawn
 * @param {SpawnRequest} request
 * @returns
 */
function spawnByRequest(spawn, request) {
  const result = spawn.spawnCreep(request.body, request.name, { memory: request.memory })
  if (result === OK) {
    registerRequest(request)
  }

  new RoomVisual(spawn.room.name).text(`🐣${request.memory.role}`, spawn.pos.x, spawn.pos.y - 1, {
    font: 0.5,
  })

  return result
}

/**
 *
 * @param {Room} room
 * @param {Array} body
 * @param {string} role
 * @param {spawnRequestOptions} options
 */
function SpawnRequest(room, body, role, options = {}) {
  this.body = body
  this.name = options.name || generateCreepName(role, room.name)
  this.memory = options.memory || { role }
  this.mission = options.mission
  this.roomName = options.roomName
  if (this.mission === undefined && this.roomName === undefined) {
    this.roomName = room.name
  }
  this.priority = DEFAULT_SPAWN_PRIORITY.indexOf(options.urgent ? role + "Urgent" : role)
}

/**
 * register creep name to the memory
 * @param {SpawnRequest} request
 */
function registerRequest(request) {
  const name = request.name

  if (request.roomName) {
    const memory = Memory.rooms[request.roomName]

    memory.creepNames = memory.creepNames || []

    memory.creepNames.push(name)

    return
  }

  if (request.mission) {
    request.mission.creepNames = request.mission.creepNames || []
    request.mission.creepNames.push(name)
    return
  }

  throw new Error("should register creep")
}

/**
 *
 * @param {string} role
 * @param {string} roomName
 * @returns
 */
function generateCreepName(role, roomName) {
  const encodedRoomName = encodeRoomName(roomName)
  const encodedTime = (Game.time % 100000).toString().padStart(5, 0)
  const encoded = parseInt(`${encodedRoomName}${encodedTime}`, 10).toString(36)

  return `${roles[role]}_${encoded}`
}

function encodeRoomName(roomName) {
  const match = roomName.match(/^([WE])(\d+)([NS])(\d+)$/)
  if (!match) {
    throw new Error("Invalid room name")
  }

  const [, horizontalDir, horizontalCoord, verticalDir, verticalCoord] = match

  const horizontalPrefix = horizontalDir === "W" ? 1 : 2
  const verticalPrefix = verticalDir === "N" ? 1 : 2

  const paddedHorizontalCoord = horizontalCoord.padStart(3, "0") // Assume max coordinate length is 3
  const paddedVerticalCoord = verticalCoord.padStart(3, "0") // Assume max coordinate length is 3

  const combinedString = `${horizontalPrefix}${paddedHorizontalCoord}${verticalPrefix}${paddedVerticalCoord}`
  const combinedNumber = parseInt(combinedString, 10)

  return combinedNumber
}

if (config.test.profiler) {
  screepsProfiler.registerObject(spawnManager, "spawnManager")
}

module.exports = spawnManager
