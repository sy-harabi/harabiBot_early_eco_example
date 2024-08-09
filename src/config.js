const constant = require("./constant")

const config = {
  test: {
    profiler: true,
    notifyInterval: 180,
    logCount: 50,
    errorCount: 10,
    speedrun: true,
    visualizeGoal: false,
  },

  economy: {
    roadRepairThreshold: 0.5,
    energyStandard: {
      1: 10000,
      2: 10000,
      3: 10000,
      4: 20000,
      5: 40000,
      6: 80000,
      7: 160000,
      8: 320000,
    },
    energyLevel: {
      rampart: 90,
      upgrade: 100,
      workerFirst: 100,
      upgradeMaxLevel: 150,
    },
    rclToBuildRampart: 5,
    rampartHitsMin: 100000,
    maxRemoteRoomDistance: 3,
    maxRemoteDistance: 200,
    reservationTickThreshold: 1000,
    energyInTerminal: 50000,
    maxBuildPower: 40,
  },

  movement: {
    defaultOpts: {
      avoidCreeps: false,
      avoidObstacleStructures: true,
      avoidSourceKeepers: true,
      repathIfStuck: 5,
      roadCost: 1,
      plainCost: 2,
      swampCost: 10,
      priority: 1,
      findRoute: true,
      maxRooms: 30,
      maxOpsPerRoom: 2000,
      heuristicWeight: 1.1,
    },
    defaultRoomCost: {
      [constant.ROOM_TYPE_HIGHWAY]: 1,
      [constant.ROOM_TYPE_NORMAL]: 1.1,
      [constant.ROOM_TYPE_CENTER]: 1,
      [constant.ROOM_TYPE_KEEPER]: 2,
    },
  },

  diplomacy: {
    allies: [],
  },
}

module.exports = config
