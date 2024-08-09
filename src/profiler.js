const config = require("./config")

let mainName
let current

const profiler = {
  init(name) {
    mainName = name
    console.log(`profile ${name}`)
    current = Game.cpu.getUsed()
  },

  log(name) {
    if (!mainName) {
      return
    }
    console.log(`${mainName}(${name}) cpu usage: ${Game.cpu.getUsed() - current}`)
    current = Game.cpu.getUsed()
  },
}

module.exports = profiler
