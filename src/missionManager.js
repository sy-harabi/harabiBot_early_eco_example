const config = require("./config")
const dataStorage = require("./dataStorage")
const missionDefenseRemote = require("./missionDefenseRemote")
const missionUtils = require("./missionUtils")
const screepsProfiler = require("./screeps-profiler")

const missionManager = {
  pretick() {
    Memory.missions = Memory.missions || {}

    const missions = missionUtils.getMissions()

    for (const type in missions) {
      for (const id in missions[type]) {
        const mission = missions[type][id]
        if (!mission) {
          continue
        }

        cacheCreeps(mission)
      }
    }

    missionUtils.getIdlers()
  },

  run() {
    missionDefenseRemote.run()
  },
}

/**
 *
 * @param {object} mission
 */
function cacheCreeps(mission) {
  const temp = missionUtils.getTemp(mission)

  temp.creeps = {}

  const creepNames = []

  for (const creepName of mission.creepNames || []) {
    const creep = Game.creeps[creepName]

    if (!creep) {
      dataStorage.clearCreepData(creepName)
      continue
    }

    creepNames.push(creepName)

    const role = creep.memory.role || "idler"

    temp.creeps[role] = temp.creeps[role] || []

    temp.creeps[role].push(creep)
  }

  mission.creepNames = creepNames
}

if (config.test.profiler) {
  screepsProfiler.registerObject(missionManager, "missionManager")
}

module.exports = missionManager
