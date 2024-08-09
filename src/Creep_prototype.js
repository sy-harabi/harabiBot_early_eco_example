const dataStorage = require("./dataStorage")

Object.defineProperties(Creep.prototype, {
  heap: {
    get() {
      const result = dataStorage.heap.creeps.get(this.name)
      if (result) {
        return result
      }
      const value = {}
      dataStorage.heap.creeps.set(this.name, value)
      return value
    },
  },
})
