const constant = require("./constant")
const creepUtils = require("./creepUtils")
const { getCombatStat } = require("./creepUtils")
const manageScout = require("./manageScout")
const missionUtils = require("./missionUtils")
const notifier = require("./notifier")
const pathUtils = require("./pathUtils")
const spawnUtils = require("./spawnUtils")
const utils = require("./utils")

const missionDefenseRemote = {
  type: constant.MISSION_TYPES.DEFENSE_REMOTE,

  createMission(room, targetRoom) {
    const targetRoomName = targetRoom.name

    if (missionUtils.getMission(this.type, targetRoomName)) {
      return
    }

    const type = this.type

    const id = targetRoomName

    const assignedRoomName = room.name

    const enemyIntel = targetRoom.memory.enemyIntel

    const danger = targetRoom.memory.danger

    const mission = {
      type,
      id,
      assignedRoomName,
      targetRoomName,
      enemyIntel,
      danger,
    }

    missionUtils.addMission(type, id, mission)
  },

  run() {
    const missions = missionUtils.getMissions(this.type)
    for (const mission of Object.values(missions)) {
      if (!mission) {
        continue
      }

      if (mission.finished) {
        notifier.record(
          `Defense remote finished. assigned room:${mission.assignedRoomName} target room:${mission.targetRoomName} result:${mission.result}`,
          { roomName: mission.targetRoomName },
        )

        const creeps = missionUtils.getAllCreeps(mission)

        for (const creep of creeps) {
          missionUtils.setIdler(creep)
        }

        missionUtils.deleteMission(mission)
        continue
      }

      runDefenseRemote(mission)
    }
  },
}

function runDefenseRemote(mission) {
  const targetRoom = Game.rooms[mission.targetRoomName]

  const assignedRoom = Game.rooms[mission.assignedRoomName]

  if (!assignedRoom) {
    mission.finished = true
    mission.result = "no assigned room"
    return
  }

  if (targetRoom) {
    mission.enemyIntel = targetRoom.memory.enemyIntel

    mission.danger = targetRoom.memory.danger

    if (mission.danger) {
      mission.lastDanger = Game.time
    }

    if (!mission.danger && Game.time > mission.lastDanger + 10) {
      mission.finished = true
      mission.result = "clear"
      return
    }
  }

  if (mission.lastDanger && Game.time > mission.lastDanger + CREEP_LIFE_TIME) {
    mission.finished = true
    mission.result = "expire"
    return
  }

  Game.map.visual.text("Defense", new RoomPosition(25, 25, mission.targetRoomName))

  const creeps = missionUtils.getAllCreeps(mission)

  const strengthMy = getStrength(creeps)

  const strengthRequired = getRequiredStrength(mission)

  if (
    strengthMy.totalAttack + strengthMy.totalRanged + strengthMy.totalHeal >
    strengthRequired.totalAttack + strengthRequired.totalRanged + strengthRequired.totalHeal
  ) {
    for (const creep of creeps) {
      const role = creep.memory.role
      const run = mapper[role]
      if (run) {
        run(mission, creep)
      }
    }
    return
  }

  const center = new RoomPosition(25, 25, assignedRoom.name)

  for (const creep of creeps) {
    creepUtils.moveCreep(creep, { pos: center, range: 15 })
  }

  const idler = missionUtils.pullIdler((creep) => {
    if (creep.getActiveBodyparts(RANGED_ATTACK) === 0) {
      return false
    }
    if (pathUtils.findRoute(creep.room.name, [mission.targetRoomName]) > (creep.ticksToLive || 1500) / 80) {
      return false
    }
    return true
  })

  if (idler) {
    missionUtils.addCreep(idler, mission, "blinky")
    return
  }

  const strengthNeeded = {
    totalAttack: strengthRequired.totalAttack - strengthMy.totalAttack,
    totalRanged: strengthRequired.totalRanged - strengthMy.totalRanged,
    totalHeal: strengthRequired.totalHeal - strengthMy.totalHeal,
  }

  const body = spawnUtils.getBlinkyBody(assignedRoom.energyCapacityAvailable, { frontMove: false, strengthNeeded })
  global.requestCreep(assignedRoom, body, "blinky", { mission })

  const required = utils.getMaxObject(
    ["totalAttack", "totalRanged", "totalHeal"],
    (property) => strengthRequired[property] - strengthMy[property],
  )

  if (required === "totalAttack") {
  } else if (required === "totalRanged") {
  } else if (required === "totalHeal") {
  }
}

const mapper = {
  blinky: runBlinky,
  attcker: runAttacker,
  healer: runHealer,
}

/**
 *
 * @param {object} mission
 * @param {Creep} creep
 * @returns
 */
function runBlinky(mission, creep) {
  creep.heal(creep)

  if (creep.room.name !== mission.targetRoomName) {
    creepUtils.moveCreep(creep, { pos: new RoomPosition(25, 25, mission.targetRoomName), range: 24 })
    return
  }

  const closest = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS)

  creep.rangedAttack(closest)

  if (creep.pos.getRangeTo(closest) > 3) {
    creepUtils.moveCreep(creep, { pos: closest.pos, range: 0 })
  } else if (creep.pos.getRangeTo(closest) < 3) {
    creepUtils.moveCreep(creep, { pos: closest.pos, range: 10 }, { flee: true })
  }
}

function runAttacker(mission, creep) {}

function runHealer(mission, creep) {}

function getStrength(creeps) {
  let totalAttack = 0
  let totalRanged = 0
  let totalHeal = 0

  for (const creep of creeps) {
    const stat = getCombatStat(creep)
    totalAttack += stat.attack
    totalRanged += stat.ranged
    totalHeal += stat.heal
  }

  return { totalAttack, totalRanged, totalHeal }
}

function getRequiredStrength(mission) {
  let totalAttack = 0
  let totalRanged = 0
  let totalHeal = 0

  if (!mission.danger) {
    return { totalAttack, totalRanged, totalHeal }
  }

  // if there was user, don't turn back to 'there is no user'

  mission.isUser =
    mission.isUser ||
    mission.enemyIntel.creeps.some(
      (info) => info.owner !== constant.INVADER_NAME && info.owner !== constant.SOURCE_KEEPER_NAME,
    )

  const ratio = mission.isUser ? 1.2 : 1

  totalAttack = mission.enemyIntel.totalAttack * ratio
  totalRanged = mission.enemyIntel.totalRanged * ratio
  totalHeal = mission.enemyIntel.totalHeal * ratio

  return { totalAttack, totalRanged, totalHeal }
}

module.exports = missionDefenseRemote
