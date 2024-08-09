const config = require("./config")
const dataStorage = require("./dataStorage")
const screepsProfiler = require("./screeps-profiler")

const CPU_INTERVAL = 20

let cpuUsed

const statistics = {
  init() {
    Memory.stats = Memory.stats || {}

    Memory.stats.gcl = Memory.stats.gcl || {}
    Memory.stats.gpl = Memory.stats.gpl || {}

    Memory.stats.minerals = Memory.stats.minerals || {}

    Memory.stats.rooms = Memory.stats.rooms || {}

    Memory.stats.cpu = Memory.stats.cpu || {}

    Memory.stats.heap = Memory.stats.heap || {}
  },

  pretick() {
    if (cpuUsed !== undefined) {
      Memory.stats.cpu.used = cpuUsed
    }
    cpuUsed = undefined

    Memory.stats.time = Game.time
    Memory.stats.credits = Game.market.credits

    Memory.stats.gcl.progress = Game.gcl.progress
    Memory.stats.gcl.progressTotal = Game.gcl.progressTotal
    Memory.stats.gcl.level = Game.gcl.level

    Memory.stats.gpl.progress = Game.gpl.progress
    Memory.stats.gpl.progressTotal = Game.gpl.progressTotal
    Memory.stats.gpl.level = Game.gpl.level

    Memory.stats.cpu.averageCpu = getCpuMovingAverage()
  },

  endTick() {
    if (Memory.stats.heap.used === undefined || Math.random() < 0.1) {
      const heapStatistics = Game.cpu.getHeapStatistics()
      const heaSize = heapStatistics.total_heap_size + heapStatistics.externally_allocated_size

      Memory.stats.heap.used = heaSize / heapStatistics.heap_size_limit
    }

    Memory.stats.cpu.bucket = Game.cpu.bucket
    Memory.stats.cpu.limit = Game.cpu.limit

    const text = JSON.stringify(Memory)

    RawMemory.set(text)

    cpuUsed = Game.cpu.getUsed()
  },
}

function getCpuMovingAverage() {
  if (dataStorage.temp._cpuMovingAverage !== undefined) {
    return dataStorage.temp._cpuMovingAverage
  }

  if (!Memory.stats || !Memory.stats.cpu) {
    return
  }

  if (Memory.globalReset && Game.time < Memory.globalReset + 20) {
    return
  }

  const lastCpu = Memory.stats.cpu.used

  if (lastCpu === undefined) {
    return
  }

  const alpha = 2 / (CPU_INTERVAL + 1)

  Memory.stats.cpu.averageCpu =
    Memory.stats.cpu.averageCpu === undefined ? lastCpu : Memory.stats.cpu.averageCpu * (1 - alpha) + lastCpu * alpha

  return (dataStorage.temp._cpuMovingAverage = Memory.stats.cpu.averageCpu)
}

if (config.test.profiler) {
  screepsProfiler.registerObject(statistics, "statistics")
}

module.exports = statistics
