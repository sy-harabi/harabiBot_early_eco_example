const config = require("./config")
const dataStorage = require("./dataStorage")
const screepsProfiler = require("./screeps-profiler")

const COLOR_TIME = "yellow"
const COLOR_TEXT = "cyan"

const TAG_COLORS = {}

const SHARD = Game.shard.name

const notifier = {
  get memory() {
    Memory.log = Memory.log || {}
    return Memory.log
  },

  get logs() {
    this.memory.normal = this.memory.normal || new Array(config.test.logCount)
    return this.memory.normal
  },

  get errorLogs() {
    this.memory.error = this.memory.error || []

    return this.memory.error
  },

  /**
   *
   * @param {string} text
   * @param {object} options
   * @param {string} options.roomName - roomName
   * @param {string} options.tag - tag
   */
  record(text, options = {}) {
    console.log(text)

    const roomName = options.roomName
    const tag = options.tag

    if (this.memory.count === undefined) {
      this.memory.count = 0
    }

    const log = {
      time: getKoreaTime(),
      text,
      roomName,
      tag,
    }

    notifyFromLog(log)

    const logs = this.logs

    logs[this.memory.count] = log

    this.memory.count = (this.memory.count + 1) % config.test.logCount
  },

  recordError(err, note) {
    Memory.log = Memory.log || {}
    Memory.log.error = Memory.log.error || []

    const errLog = Memory.log.error

    const stack = err.stack
    const tick = Game.time

    const log = { tick, stack, note }

    console.log(`<span style = "color: red">[tick: ${log.tick}] [${note}]</span> \n ${log.stack}`)

    if (errLog.some((log) => log.stack === stack)) {
      return
    }

    const koreaDateText = getKoreaTime()
    log.time = koreaDateText

    errLog.push(log)

    this.record(`new Error:[${log.note}]</span> \n ${log.stack}`)

    while (errLog.length > config.test.errorCount) {
      errLog.shift()
    }
  },

  logError() {
    Memory.log.error = Memory.log.error || []

    const errLog = Memory.log.error

    for (const log of errLog) {
      console.log(`<span style = "color: red">[tick: ${log.tick}] [${log.time}] [${log.note}]</span> \n ${log.stack}`)
    }
  },
}

global.log = function () {
  if (!Memory.log) {
    return "no log"
  }

  let num = 1

  const logLength = config.test.logCount

  const currentCount = Memory.log.count

  let count = currentCount

  const logs = Memory.log.normal

  do {
    const log = logs[count]

    count = (count + 1) % logLength
    num++
    if (!log) {
      continue
    }

    console.log(`#${padNumber(num, 2)}: ` + getConsoleTextFromLog(log))
  } while (count !== currentCount)

  return "end"
}

function getRoomUrl(roomName) {
  return `https://screeps.com/${SHARD === "shardSeason" ? "season" : "a"}/#!/room/${SHARD}/${roomName}`
}

function getRoomHyperLink(roomName) {
  const url = getRoomUrl(roomName)
  return `<a href="${url}" target="_blank">(${roomName})</a>`
}

/**
 *
 * @returns text with format YYYY.MM.DD. HH:MM
 */
function getKoreaTime() {
  if (dataStorage.temp.koreaTime) {
    return dataStorage.temp.koreaTime
  }

  const now = new Date()
  const utcNow = now.getTime() + now.getTimezoneOffset() * 60 * 1000
  const koreaNow = utcNow + 9 * 60 * 60 * 1000
  const koreaDate = new Date(koreaNow)

  const month = padNumber(koreaDate.getMonth() + 1, 2)
  const date = padNumber(koreaDate.getDate(), 2)

  const hours = padNumber(koreaDate.getHours(), 2)
  const minutes = padNumber(koreaDate.getMinutes(), 2)

  const result = `${koreaDate.getFullYear()}.${month}.${date}. ${hours}:${minutes}`

  return (dataStorage.temp.koreaTime = result)
}

function padNumber(number, size) {
  return String(number).padStart(size, "0")
}

/**
 *
 * @param {string} text
 * @param {string} color
 * @returns
 */
function getColoredText(text, color) {
  return String(`<span style = "color: ${color}">${text}</span>`)
}

/**
 * @typedef {object} log
 * @property {string} time - korea time with format YYYY.MM.DD. HH:MM
 * @property {string} text - text to log
 * @property {string} roomName - roomName
 * @property {string} tag - tag
 */

/**
 *
 * @param {log} log
 */
function notifyFromLog(log, interval = config.test.notifyInterval) {
  const roomNameText = log.roomName ? `(${log.roomName})` : ""
  const tagText = log.tag ? `[${log.tag} ]` : ""
  const notifyText = `[${log.time}] ${tagText}${log.text} ${roomNameText}`
  Game.notify(notifyText, interval)
}

/**
 *
 * @param {log} log
 */
function getConsoleTextFromLog(log) {
  const time = getColoredText(`[${log.time}] `, COLOR_TIME)
  const text = getColoredText(`${log.text} `, COLOR_TEXT)
  const roomName = log.roomName ? getRoomHyperLink(log.roomName) : ""
  const tag = log.tag ? getColoredText(`[${log.tag}] `, TAG_COLORS[log.tag]) : ""
  return `${time}${tag}${text}${roomName}`
}

if (config.test.profiler) {
  screepsProfiler.registerObject(notifier, "notifier")
}

module.exports = notifier
