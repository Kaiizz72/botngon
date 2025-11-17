// bot.js — Dream & Marlow HT1 PvP bots (không cần mineflayer-auto-eat, không dùng mineflayer-pvp)
// Yêu cầu: node 18+, mineflayer 4.31+, pathfinder, vec3

const mineflayer = require('mineflayer')
const {
  pathfinder,
  Movements,
  goals: { GoalNear }
} = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')

const SERVER_HOST = process.env.SERVER_HOST || 'play2.eternalzero.cloud'
const SERVER_PORT = Number(process.env.SERVER_PORT || 27199)
const AUTH_MODE = process.env.AUTH_MODE || 'offline'

// 2 bot tên như yêu cầu
const BOT_NAMES = ['NhatLMAO', 'Swight']

function wait (ms) {
  return new Promise(res => setTimeout(res, ms))
}

function randChoice (arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function findItem (bot, names) {
  const list = Array.isArray(names) ? names : [names]
  return bot.inventory.items().find(it => list.includes(it.name))
}

function findFoodItem (bot) {
  const foodNames = [
    'cooked_beef',
    'cooked_porkchop',
    'cooked_chicken',
    'bread',
    'cooked_mutton',
    'cooked_rabbit',
    'baked_potato',
    'cooked_cod',
    'cooked_salmon',
    'pumpkin_pie'
  ]
  return bot.inventory.items().find(it => foodNames.includes(it.name))
}

function findSword (bot) {
  const swordNames = [
    'netherite_sword',
    'diamond_sword',
    'iron_sword',
    'stone_sword',
    'golden_sword',
    'wooden_sword'
  ]
  return bot.inventory.items().find(it => swordNames.includes(it.name))
}

async function equipSword (bot) {
  try {
    const sword = findSword(bot)
    if (sword) {
      await bot.equip(sword, 'hand')
    }
  } catch (_) {}
}

function getNearestEnemyPlayer (bot, maxDistance) {
  let best = null
  let bestDist = maxDistance
  for (const id in bot.entities) {
    const e = bot.entities[id]
    if (!e || e.type !== 'player') continue
    if (!e.username || e.username === bot.username) continue
    // Không đánh nhau giữa Dream & Marlow, coi như 1 team
    if (BOT_NAMES.includes(e.username)) continue
    if (!e.position) continue

    const dist = bot.entity.position.distanceTo(e.position)
    if (dist < bestDist) {
      best = e
      bestDist = dist
    }
  }
  return best
}

function isEntityInWeb (bot, entity) {
  if (!entity || !entity.position) return false
  const feet = entity.position.offset(0, 0.1, 0)
  const block = bot.blockAt(feet)
  if (!block) return false
  return block.name && block.name.includes('web')
}

function isBotInWeb (bot) {
  return isEntityInWeb(bot, bot.entity)
}

// ===== PHÁ TƠ NHỆN BẰNG KIẾM =====
function getNearbyWebBlocks (bot, radius = 1) {
  const pos = bot.entity.position.floored()
  const webs = []
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -1; dy <= 2; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const p = pos.offset(dx, dy, dz)
        const b = bot.blockAt(p)
        if (b && b.name && b.name.includes('web')) {
          webs.push(b)
        }
      }
    }
  }
  return webs
}

async function breakWebAround (bot) {
  try {
    if (bot._breakingWeb) return
    bot._breakingWeb = true

    const sword = findSword(bot)
    if (sword) {
      await bot.equip(sword, 'hand')
    }

    const webs = getNearbyWebBlocks(bot, 1)
    for (const block of webs) {
      try {
        await bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true)
        await bot.dig(block)
      } catch (_) {}
    }
  } catch (_) {
  } finally {
    bot._breakingWeb = false
  }
}

// ===== Xô nước phá tơ (dự phòng) =====
async function escapeWebWithWater (bot) {
  try {
    if (bot._escapingWeb) return
    const waterBucket = findItem(bot, 'water_bucket')
    if (!waterBucket) return

    bot._escapingWeb = true

    const feet = bot.entity.position.floored()
    const below = bot.blockAt(feet.offset(0, -1, 0))
    if (below) {
      await bot.equip(waterBucket, 'hand')
      await bot.lookAt(below.position.offset(0.5, 1, 0.5), true)
      await bot.placeBlock(below, new Vec3(0, 1, 0))
    }

    setTimeout(async () => {
      try {
        const bucket = findItem(bot, 'bucket')
        if (!bucket) return
        const water = bot.findBlock({
          matching: b => b && b.name === 'water',
          maxDistance: 5
        })
        if (water) {
          await bot.equip(bucket, 'hand')
          await bot.lookAt(water.position.offset(0.5, 0.5, 0.5), true)
          await bot.activateBlock(water)
        }
      } catch (_) {
      } finally {
        bot._escapingWeb = false
      }
    }, 1200)
  } catch (_) {
    bot._escapingWeb = false
  }
}

async function ensureOffhand (bot) {
  try {
    const now = Date.now()
    const hp = bot.health
    if (hp <= 0) return

    const totem = findItem(bot, ['totem_of_undying', 'totem'])
    const gapple = findItem(bot, ['enchanted_golden_apple', 'golden_apple'])

    if (totem && (hp <= 6 || (bot._dangerUntil && now < bot._dangerUntil))) {
      await bot.equip(totem, 'off-hand')
      return
    }

    if (gapple) {
      await bot.equip(gapple, 'off-hand')
    }
  } catch (_) {}
}

// ===== POTION HELPERS =====
function findSplashPotion (bot, type) {
  const items = bot.inventory.items().filter(it => it.name === 'splash_potion')
  for (const it of items) {
    const potionId = it.nbt?.value?.Potion?.value || ''
    if (type === 'speed' && potionId.includes('swiftness')) return it
    if (type === 'strength' && potionId.includes('strength')) return it
    if (type === 'healing' && (potionId.includes('healing') || potionId.includes('heal'))) return it
  }
  return null
}

async function throwSelfPotion (bot, item) {
  try {
    await bot.equip(item, 'hand')
    const lookPos = bot.entity.position.offset(0, -1, 0)
    await bot.lookAt(lookPos, false)
    bot.activateItem()
    setTimeout(() => {
      try { bot.deactivateItem() } catch (_) {}
    }, 300)
  } catch (_) {}
}

// ===== ƯU TIÊN TÁO VÀNG, HEALING CHỈ KHI RẤT THẤP MÁU =====
async function emergencyHeal (bot) {
  try {
    const hp = bot.health
    if (hp <= 0) return
    const now = Date.now()

    if (!bot._potionState) {
      bot._potionState = {
        lastSpeedPot: 0,
        lastStrengthPot: 0,
        lastHealPot: 0
      }
    }

    // HP: 20 = 10 tim
    const gappleThreshold = 14  // <=14 máu (~mất 3 tim) => ăn táo
    const healThreshold = 6     // <=6 máu (3 tim còn lại) => mới xài Healing

    // 1) ƯU TIÊN TÁO VÀNG khi đã mất ~3 tim nhưng chưa quá nguy hiểm
    if (hp <= gappleThreshold && hp > healThreshold) {
      const gapple = findItem(bot, ['enchanted_golden_apple', 'golden_apple'])
      if (gapple) {
        await bot.equip(gapple, 'hand')
        bot.activateItem()
        setTimeout(() => {
          try { bot.deactivateItem() } catch (_) {}
        }, 900)
        return
      }
    }

    // 2) RẤT NGUY HIỂM (≤ 3 tim) mới xài Splash Healing
    if (hp <= healThreshold) {
      if (now - bot._potionState.lastHealPot > 4000) {
        const healPot = findSplashPotion(bot, 'healing')
        if (healPot) {
          bot._potionState.lastHealPot = now
          await throwSelfPotion(bot, healPot)
          return
        }
      }

      // Không có Healing thì fallback ăn táo để khỏi chết
      const gapple = findItem(bot, ['enchanted_golden_apple', 'golden_apple'])
      if (gapple) {
        await bot.equip(gapple, 'hand')
        bot.activateItem()
        setTimeout(() => {
          try { bot.deactivateItem() } catch (_) {}
        }, 900)
        return
      }
    }
  } catch (_) {}
}

async function autoEatLoop (bot) {
  if (bot._autoEating) return
  bot._autoEating = true

  const eatInterval = 1200

  const eatTick = async () => {
    try {
      if (!bot.player || !bot.entity) return
      if (bot.health <= 0) return

      if (bot.food < 16) {
        const food = findFoodItem(bot)
        if (food) {
          await bot.equip(food, 'hand')
          bot.activateItem()
          setTimeout(() => {
            try { bot.deactivateItem() } catch (_) {}
          }, 900)
        }
      }
    } catch (_) {
    } finally {
      setTimeout(eatTick, eatInterval)
    }
  }

  setTimeout(eatTick, eatInterval)
}

async function throwPearlAt (bot, target) {
  try {
    const pearl = findItem(bot, 'ender_pearl')
    if (!pearl) return

    await bot.equip(pearl, 'hand')
    await bot.lookAt(target.position.offset(0, 1.5, 0), false)
    bot.activateItem()
  } catch (_) {}
}

async function placeWebTrap (bot, target) {
  try {
    const web = findItem(bot, ['cobweb', 'web'])
    if (!web) return

    const dist = bot.entity.position.distanceTo(target.position)
    if (dist > 4) return

    const below = bot.blockAt(target.position.offset(0, -1, 0).floored())
    if (!below) return

    await bot.equip(web, 'hand')
    await bot.lookAt(target.position.offset(0.5, 0.2, 0.5), true)
    await bot.placeBlock(below, new Vec3(0, 1, 0))

    equipSword(bot)
  } catch (_) {}
}

async function useBuffPotions (bot) {
  try {
    const now = Date.now()
    if (!bot._potionState) {
      bot._potionState = {
        lastSpeedPot: 0,
        lastStrengthPot: 0,
        lastHealPot: 0
      }
    }

    const speedCooldown = 45000
    const strengthCooldown = 45000

    if (now - bot._potionState.lastSpeedPot > speedCooldown) {
      const speedPot = findSplashPotion(bot, 'speed')
      if (speedPot) {
        bot._potionState.lastSpeedPot = now
        await throwSelfPotion(bot, speedPot)
      }
    }

    if (now - bot._potionState.lastStrengthPot > strengthCooldown) {
      const strPot = findSplashPotion(bot, 'strength')
      if (strPot) {
        bot._potionState.lastStrengthPot = now
        await throwSelfPotion(bot, strPot)
      }
    }
  } catch (_) {}
}

async function shootBowAt (bot, target, lightCharge = false) {
  try {
    const bow = findItem(bot, 'bow')
    const arrow = findItem(bot, ['arrow', 'tipped_arrow'])
    if (!bow || !arrow) return

    await bot.equip(bow, 'hand')
    await bot.lookAt(target.position.offset(0, 1.4, 0), false)

    const chargeTime = lightCharge ? 180 : 450

    bot.activateItem()
    setTimeout(() => {
      try { bot.deactivateItem() } catch (_) {}
    }, chargeTime)

    setTimeout(() => {
      equipSword(bot)
    }, chargeTime + 50)
  } catch (_) {}
}

// ===== Durability & XP bottle =====
function isArmorDamaged (bot) {
  const mcData = bot._mcData
  if (!mcData) return false

  const armorNames = [
    'netherite_helmet', 'netherite_chestplate', 'netherite_leggings', 'netherite_boots',
    'diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots',
    'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'
  ]

  const armorItems = bot.inventory.items().filter(it => armorNames.includes(it.name))
  if (armorItems.length === 0) return false

  let totalRatio = 0
  let count = 0

  for (const item of armorItems) {
    const def = mcData.itemsByName[item.name]
    if (!def || !def.maxDurability) continue
    const max = def.maxDurability
    const used = item.nbt?.value?.Damage?.value || 0
    const remaining = Math.max(0, max - used)
    const ratio = remaining / max
    totalRatio += ratio
    count++
  }

  if (count === 0) return false
  const avgRatio = totalRatio / count
  return avgRatio < 0.5
}

async function useXpBottleForArmor (bot) {
  try {
    const now = Date.now()
    if (bot._lastXpBottle && now - bot._lastXpBottle < 8000) return
    if (!isArmorDamaged(bot)) return

    const xpBottle = findItem(bot, 'experience_bottle')
    if (!xpBottle) return

    bot._lastXpBottle = now
    await bot.equip(xpBottle, 'hand')
    const lookPos = bot.entity.position.offset(0, -1, 0)
    await bot.lookAt(lookPos, false)
    bot.activateItem()
    setTimeout(() => {
      try { bot.deactivateItem() } catch (_) {}
    }, 200)
  } catch (_) {}
}

// ===== Aim assist / trigger bot =====
function angleDiff (a, b) {
  let d = a - b
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}

function canTriggerAttack (bot, target, maxAngleDeg) {
  try {
    if (!bot.entity || !target || !target.position) return false

    const eyeH = bot.entity.height || 1.62
    const tgtH = target.height || 1.62

    const eye = bot.entity.position.offset(0, eyeH * 0.9, 0)
    const tEye = target.position.offset(0, tgtH * 0.9, 0)

    const dx = tEye.x - eye.x
    const dy = tEye.y - eye.y
    const dz = tEye.z - eye.z

    const yawTo = Math.atan2(-dx, -dz)
    const pitchTo = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz))

    const yawDiff = angleDiff(bot.entity.yaw, yawTo)
    const pitchDiff = angleDiff(bot.entity.pitch, pitchTo)

    const angle = Math.sqrt(yawDiff * yawDiff + pitchDiff * pitchDiff)
    const deg = angle * 180 / Math.PI

    return deg <= maxAngleDeg
  } catch (_) {
    return true
  }
}

function setupHT1Brain (bot) {
  bot._combatState = {
    lastPearl: 0,
    lastWeb: 0,
    lastBow: 0,
    lastDist: null,
    nextWTap: 0,
    lastJump: 0,
    lastComboReset: 0,
    strafeDir: null,
    nextStrafeChange: 0,
    retreatUntil: 0,
    lockedTargetId: null,
    attackCooldown: 600,
    nextAttack: 0
  }

  bot._potionState = {
    lastSpeedPot: 0,
    lastStrengthPot: 0,
    lastHealPot: 0
  }

  bot.on('health', () => {
    const hp = bot.health
    if (hp <= 8 && hp > 0) {
      bot._dangerUntil = Date.now() + 7000
      if (bot._combatState) {
        bot._combatState.retreatUntil = Date.now() + 2200
      }
    }
    ensureOffhand(bot)
    emergencyHeal(bot)
  })

  bot.on('death', () => {
    bot.setControlState('jump', false)
    bot.setControlState('sprint', false)
    bot.setControlState('forward', false)
    bot.setControlState('back', false)
    bot.setControlState('left', false)
    bot.setControlState('right', false)
    if (bot._combatState) bot._combatState.lockedTargetId = null
  })

  bot.on('respawn', () => {
    console.log(`[${bot.username}] respawned, ready to fight again`)
    bot._homePos = bot.entity.position.clone()
    bot._combatState.lastDist = null
    bot._dangerUntil = Date.now() + 5000
    bot._combatState.lockedTargetId = null
  })

  autoEatLoop(bot)

  setInterval(() => {
    if (!bot.entity || !bot.entity.position) return

    const now = Date.now()
    const cs = bot._combatState

    if (bot._homePos) {
      const homeDist = bot.entity.position.distanceTo(bot._homePos)
      if (homeDist > 100) {
        bot.setControlState('jump', false)
        bot.setControlState('sprint', false)
        bot.setControlState('forward', false)
        bot.setControlState('back', false)
        bot.setControlState('left', false)
        bot.setControlState('right', false)

        const goal = new GoalNear(
          bot._homePos.x,
          bot._homePos.y,
          bot._homePos.z,
          2
        )
        bot.pathfinder.setGoal(goal)
        return
      }
    }

    // ===== Chọn target: luật "đánh A thì kệ B" =====
    let target = null

    if (cs.lockedTargetId != null) {
      const ent = bot.entities[cs.lockedTargetId]
      if (
        ent &&
        ent.type === 'player' &&
        ent.username &&
        !BOT_NAMES.includes(ent.username) &&
        ent.position
      ) {
        const distHomeOk =
          !bot._homePos ||
          ent.position.distanceTo(bot._homePos) <= 100

        if (distHomeOk) {
          target = ent
        } else {
          cs.lockedTargetId = null
        }
      } else {
        cs.lockedTargetId = null
      }
    }

    if (!target) {
      const near = getNearestEnemyPlayer(bot, 80)
      if (near) {
        cs.lockedTargetId = near.id
        target = near
      }
    }

    if (target) {
      const dist = bot.entity.position.distanceTo(target.position)
      const targetInWeb = isEntityInWeb(bot, target)

      useBuffPotions(bot)

      bot.setControlState('forward', false)
      bot.setControlState('back', false)
      bot.setControlState('left', false)
      bot.setControlState('right', false)

      const hp = bot.health
      const LOW_HP = 8
      const RETREAT_TIME = 2200

      let retreating = false

      if (hp <= LOW_HP) {
        cs.retreatUntil = now + RETREAT_TIME
      }
      if (cs.retreatUntil && now < cs.retreatUntil) {
        retreating = true
      }

      if (retreating) {
        bot.setControlState('back', true)
        bot.setControlState('sprint', true)
        bot.setControlState('jump', false)
        useXpBottleForArmor(bot)
      } else {
        if (dist > 2.8 && dist < 20) {
          bot.setControlState('forward', true)
          bot.setControlState('sprint', true)
        }

        if (dist < 7) {
          if (!cs.strafeDir || now > cs.nextStrafeChange) {
            cs.strafeDir = randChoice(['left', 'right'])
            cs.nextStrafeChange = now + 1200 + Math.random() * 800
          }
          if (cs.strafeDir === 'left') {
            bot.setControlState('left', true)
          } else {
            bot.setControlState('right', true)
          }
        } else {
          cs.strafeDir = null
        }

        if (dist < 6) {
          if (!cs.lastJump || now - cs.lastJump > 1500) {
            cs.lastJump = now
            bot.setControlState('jump', true)
            setTimeout(() => {
              try { bot.setControlState('jump', false) } catch (_) {}
            }, 200)
          }

          const closing =
            cs.lastDist !== null &&
            dist < cs.lastDist + 0.15

          if (
            closing &&
            dist < 3.4 &&
            now - cs.lastComboReset > 900
          ) {
            cs.lastComboReset = now

            bot.setControlState('jump', true)
            setTimeout(() => {
              try { bot.setControlState('jump', false) } catch (_) {}
            }, 200)

            bot.setControlState('forward', false)
            bot.setControlState('sprint', false)
            setTimeout(() => {
              try {
                bot.setControlState('sprint', true)
                if (dist < 5) bot.setControlState('forward', true)
              } catch (_) {}
            }, 110)
          }
        } else {
          bot.setControlState('jump', false)
        }
      }

      // luôn nhìn target A
      bot.lookAt(target.position.offset(0, 1.6, 0), false).catch(() => {})

      if (cs.lastDist !== null) {
        const diff = dist - cs.lastDist
        const isRunningAway = diff > 2 && dist > 10

        if (isRunningAway) {
          if (now - cs.lastPearl > 3500) {
            cs.lastPearl = now
            throwPearlAt(bot, target)
            setTimeout(() => {
              placeWebTrap(bot, target)
            }, 300)
          }
        }
      }
      cs.lastDist = dist

      if (dist > 12 && dist < 60 && now - cs.lastPearl > 5000) {
        cs.lastPearl = now
        throwPearlAt(bot, target)
      }

      if (dist < 4 && now - cs.lastWeb > 3500) {
        cs.lastWeb = now
        placeWebTrap(bot, target)
      }

      if (targetInWeb && now - cs.lastBow > 650) {
        cs.lastBow = now
        shootBowAt(bot, target, true)
      }

      const inAttackRange = dist <= 3.1
      if (!retreating && inAttackRange) {
        if (now >= cs.nextAttack && canTriggerAttack(bot, target, 12)) {
          cs.nextAttack = now + cs.attackCooldown
          try {
            equipSword(bot)
            bot.attack(target)
          } catch (_) {}
        }
      }

      if (!targetInWeb) {
        equipSword(bot)
      }
    } else {
      bot.setControlState('jump', false)
      bot.setControlState('sprint', false)
      bot.setControlState('forward', false)
      bot.setControlState('back', false)
      bot.setControlState('left', false)
      bot.setControlState('right', false)
      cs.lastDist = null
      cs.lockedTargetId = null
      useXpBottleForArmor(bot)
    }

    if (isBotInWeb(bot)) {
      breakWebAround(bot)
      escapeWebWithWater(bot)
    }
  }, 250)
}

function createBot (name) {
  const bot = mineflayer.createBot({
    host: SERVER_HOST,
    port: SERVER_PORT,
    username: name,
    auth: AUTH_MODE
  })

  bot.loadPlugin(pathfinder)

  bot.once('spawn', () => {
    console.log(`[${name}] joined with HT1 brain!`)

    const mcData = require('minecraft-data')(bot.version)
    bot._mcData = mcData

    const movements = new Movements(bot, mcData)
    bot.pathfinder.setMovements(movements)

    bot._homePos = bot.entity.position.clone()

    setupHT1Brain(bot)
  })

  bot.on('kicked', r => console.log(`[${name}] kicked:`, r))
  bot.on('error', e => console.log(`[${name}] error:`, e))

  bot.on('end', reason => {
    console.log(`[${name}] disconnected (${reason}), reconnecting in 10s`)
    setTimeout(() => {
      createBot(name)
    }, 10000)
  })

  return bot
}

;(async () => {
  for (const name of BOT_NAMES) {
    createBot(name)
    await wait(20000)
  }
})()
