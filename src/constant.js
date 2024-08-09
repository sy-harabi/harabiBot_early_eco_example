const BUILD_PRIORITY_ARRAY = [
  STRUCTURE_SPAWN,
  STRUCTURE_STORAGE,
  STRUCTURE_EXTENSION,
  STRUCTURE_CONTAINER,

  STRUCTURE_TOWER,
  STRUCTURE_LINK,

  STRUCTURE_EXTRACTOR,
  STRUCTURE_TERMINAL,
  STRUCTURE_LAB,

  STRUCTURE_RAMPART,
  STRUCTURE_WALL,
  STRUCTURE_ROAD,

  STRUCTURE_OBSERVER,
  STRUCTURE_FACTORY,
  STRUCTURE_POWER_SPAWN,
  STRUCTURE_NUKER,
]

const BUILD_PRIORITY = {}

const KEEPER_KILLER_BODY = []

for (let i = 0; i < 25; i++) {
  KEEPER_KILLER_BODY.push(MOVE)
}
for (let i = 0; i < 18; i++) {
  KEEPER_KILLER_BODY.push(ATTACK)
}
for (let i = 0; i < 5; i++) {
  KEEPER_KILLER_BODY.push(HEAL)
}
for (let i = 0; i < 1; i++) {
  KEEPER_KILLER_BODY.push(ATTACK)
}
for (let i = 0; i < 1; i++) {
  KEEPER_KILLER_BODY.push(HEAL)
}

for (const structureType of BUILD_PRIORITY_ARRAY) {
  BUILD_PRIORITY[structureType] = BUILD_PRIORITY_ARRAY.indexOf(structureType)
}

const constant = {
  MISSION_TYPES: {
    DEFENSE_REMOTE: "defenseRemote",
  },

  SOURCE_KEEPER_NAME: "Source Keeper",

  KEEPER_KILLER_BODY,

  INVADER_NAME: "Invader",

  ROOM_TYPE_HIGHWAY: "highway",
  ROOM_TYPE_NORMAL: "normal",
  ROOM_TYPE_CENTER: "center",
  ROOM_TYPE_KEEPER: "keeper",

  BUILD_PRIORITY: BUILD_PRIORITY,

  THREAT_BODY_TYPES: [ATTACK, RANGED_ATTACK, HEAL, WORK, CLAIM],

  COMBATANT_BODY_TYPES: [ATTACK, RANGED_ATTACK, HEAL],

  ATTACKER_BODY_TYPES: [ATTACK, RANGED_ATTACK],

  MY_NAME: (function () {
    const rooms = Object.values(Game.rooms)
    for (const room of rooms) {
      if (!room.controller) {
        continue
      }
      if (room.controller.my) {
        return room.controller.owner.username
      }
    }
  })(),

  COLOR_NEON_CYAN: "#4deeea",
  COLOR_NEON_GREEN: "#74ee15",
  COLOR_NEON_YELLOW: "#ffe700",
  COLOR_NEON_PURPLE: "#f000ff",
  COLOR_NEON_BLUE: "#001eff",
  COLOR_NEON_RED: "#fe0000",

  MANAGER_NAME_ROOM: "roomManager",
  MANAGER_NAME_SPAWN: "spawnManager",

  INTERVAL_CONSTRUCT: CREEP_LIFE_TIME,

  RETURN_COMPLETE: 0,
  RETURN_ONGOING: -1,
  RETURN_FAIL: -2,

  SCOUT_KEYS: {
    TYPE: 0,
    CONTROLLER_COORD_PACKED: 1,
    SOURCE_COORDS_PACKED: 2,
    MINERAL_INFOS: 3,
    OWNER: 4,
    RCL: 5,
    RESERVATION_OWNER: 6,
    LAST_SCOUT: 7,
    KEEPER_LAIR_COORDS_PACKED: 8,
  },
}

module.exports = constant
