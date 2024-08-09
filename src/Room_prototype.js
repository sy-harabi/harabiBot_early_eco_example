const dataStorage = require("./dataStorage")
const MinHeap = require("./util_min_heap")

Object.defineProperties(Room.prototype, {
  my: {
    get() {
      if (this._my !== undefined) {
        return this._my
      }

      return (this._my = this.controller && this.controller.my)
    },
  },

  heap: {
    get() {
      const result = dataStorage.heap.rooms.get(this.name)
      if (result) {
        return result
      }
      const value = {}
      dataStorage.heap.rooms.set(this.name, value)
      return value
    },
  },

  spawnQueue: {
    get() {
      if (this._spawnQueue) {
        return this._spawnQueue
      }

      this._spawnQueue = new MinHeap((request) => {
        return request.priority
      })

      return this._spawnQueue
    },
  },
})

Room.prototype.findMyCreeps = function () {
  const creeps = this.find(FIND_MY_CREEPS)
  const powerCreeps = this.find(FIND_MY_POWER_CREEPS)
  return creeps.concat(powerCreeps)
}
