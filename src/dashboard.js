const { ResourceColors } = require("./util_roomVisual_prototype")
const utils = require("./utils")

const OPACITY = 0.5

const START_COORDS = { x: -0.5, y: 0.5 }

const SIZE = 0.7

const drawDashboard = function () {
  if (!Memory.myRooms) {
    return
  }

  const numMyRoom = Memory.myRooms.length

  visualizeBasicInfo(numMyRoom)

  new RoomVisual().rect(START_COORDS.x, START_COORDS.y - 1, 0.5, numMyRoom + 3, {
    fill: "black",
    opacity: 0.3,
  })
}

function visualizeBasicInfo(numMyRoom) {
  const option = { color: "cyan", strokeWidth: 0.2, align: "middle", opacity: OPACITY, font: SIZE }

  new RoomVisual().text("Time " + Game.time, START_COORDS.x + 2, START_COORDS.y, option)

  const averageCpu = Memory.stats.cpu.averageCpu

  const cpuLimit = Memory.stats.cpu.limit

  if (averageCpu) {
    new RoomVisual().text(
      `CPU ${utils.adjustDecimal(averageCpu, 1)}/${cpuLimit}(${utils.adjustDecimal((100 * averageCpu) / cpuLimit, 1)})`,
      START_COORDS.x + 10,
      START_COORDS.y,
      option,
    )
  }
  new RoomVisual().text("Bucket " + Memory.stats.cpu.bucket, START_COORDS.x + 18, START_COORDS.y, option)
  new RoomVisual().text(`Room: ${numMyRoom}`, 26, START_COORDS.y, option)
  new RoomVisual().text(`Creep: ${Object.keys(Game.creeps).length}`, 42, START_COORDS.y, option)
}

module.exports = drawDashboard
