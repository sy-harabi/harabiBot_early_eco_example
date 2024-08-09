const config = require("./config")
const dataStorage = require("./dataStorage")
const screepsProfiler = require("./screeps-profiler")

const missionUtils = {
  /**
   * @callback pullIdlerCallback
   * @param {Creep} creep
   */

  /**
   *
   * @param {Room} room
   * @param {pullIdlerCallback} callback
   * @returns
   */
  pullIdler(callback) {
    const idlers = missionUtils.getIdlers()

    for (const idler of idlers) {
      if (idler.memory.role || !callback(idler)) {
        continue
      }

      return idler
    }
  },

  getIdlers() {
    if (dataStorage.temp.idlers) {
      return dataStorage.temp.idlers
    }

    dataStorage.temp.idlers = []
    const idlerNames = []
    for (const creepName of Memory.idlerNames || []) {
      const creep = Game.creeps[creepName]
      if (!creep) {
        dataStorage.clearCreepData(creepName)
        continue
      }
      dataStorage.temp.idlers.push(creep)
      idlerNames.push(creepName)
    }

    Memory.idlerNames = idlerNames

    return dataStorage.temp.idlers
  },

  setIdler(creep, mission) {
    creep.memory = {}

    if (mission) {
      mission.creepNames = mission.creepNames || []

      mission.creepNames = mission.creepNames.filter((creepName) => creepName !== creep.name)
    }

    Memory.idlerNames = Memory.idlerNames || []

    if (Memory.idlerNames.includes(creep.name)) {
      return
    }

    Memory.idlerNames.push(creep.name)
  },

  addCreep(creep, mission, role) {
    creep.memory.role = role

    mission.creepNames = mission.creepNames || []

    if (mission.creepNames.includes(creep.name)) {
      return
    }

    mission.creepNames.push(creep.name)
  },
  getAllCreeps(mission) {
    const temp = this.getTemp(mission)
    if (temp._allCreeps) {
      return temp._allCreeps
    }

    if (!temp.creeps) {
      return (temp._allCreeps = [])
    }

    const result = []

    for (const role in temp.creeps) {
      result.push(...temp.creeps[role])
    }

    return (temp._allCreeps = result)
  },

  getCreepsByRole(mission, role) {
    const temp = this.getTemp(mission)

    if (!temp.creeps) {
      return []
    }

    if (!temp.creeps[role]) {
      return []
    }

    return temp.creeps[role]
  },

  getTemp(mission) {
    dataStorage.temp.missions = dataStorage.temp.missions || {}

    dataStorage.temp.missions[mission.type] = dataStorage.temp.missions[mission.type] || {}

    return (dataStorage.temp.missions[mission.type][mission.id] =
      dataStorage.temp.missions[mission.type][mission.id] || {})
  },

  /**
   * get missions by type. If type is undefined, return all the missions
   * @param {string} type
   */
  getMissions(type) {
    Memory.missions = Memory.missions || {}

    if (type) {
      Memory.missions[type] = Memory.missions[type] || {}
      return Memory.missions[type]
    }

    return Memory.missions
  },

  /**
   *
   * @param {string} type
   * @param {string} id
   */
  getMission(type, id) {
    const missions = this.getMissions(type)
    return missions[id]
  },

  /**
   * delete mission
   * @param {object} mission
   */
  deleteMission(mission) {
    const type = mission.type
    const id = mission.id

    // if (type === undefined || id === undefined) {
    //   return false
    // }

    const missions = this.getMissions(type)

    missions[id] = undefined

    return true
  },

  /**
   *
   * @param {string} type
   * @param {string} id
   * @param {object} mission
   */
  addMission(type, id, mission) {
    const missions = this.getMissions(type)
    missions[id] = mission
  },
}

if (config.test.profiler) {
  screepsProfiler.registerObject(missionUtils, "missionUtils")
}

module.exports = missionUtils
