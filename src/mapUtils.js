const constant = require("./constant")

const mapUtils = {
  getDanger(roomName) {
    if (!Memory.rooms || !Memory.rooms[roomName]) {
      return false
    }

    const memory = Memory.rooms[roomName]

    if (memory.lastDanger && Game.time > memory.lastDanger + CREEP_LIFE_TIME) {
      memory.danger = false
      memory.lastDanger = undefined
      memory.enemyIntel = undefined
      return false
    }

    return memory.danger
  },

  /**
   * @param {string} roomName
   */
  getIntel(roomName) {
    if (!Memory.rooms || !Memory.rooms[roomName]) {
      return
    }
    return Memory.rooms[roomName].intel
  },

  getRoomType(roomName) {
    const intel = this.getIntel(roomName)

    if (intel) {
      return intel[constant.SCOUT_KEYS.TYPE]
    }

    const roomCoord = this.getRoomCoord(roomName)
    const x = roomCoord.x % 10
    const y = roomCoord.y % 10

    if (x === 0 || y === 0) {
      return constant.ROOM_TYPE_HIGHWAY
    }

    if (x < 4 || x > 6 || y < 4 || y > 6) {
      return constant.ROOM_TYPE_NORMAL
    }

    if (x === 5 && y === 5) {
      return constant.ROOM_TYPE_CENTER
    }

    return constant.ROOM_TYPE_KEEPER
  },

  getRoomCoord(roomName) {
    const roomCoord = roomName.match(/[a-zA-Z]+|[0-9]+/g)
    roomCoord[1] = Number(roomCoord[1])
    roomCoord[3] = Number(roomCoord[3])
    const x = roomCoord[1]
    const y = roomCoord[3]
    return { x, y }
  },
}

module.exports = mapUtils
