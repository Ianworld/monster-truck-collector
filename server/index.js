import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const players = {};
let gems = [];
const obstacles = [
  // Jumps
  { id: 'j1', type: 'jump', x: -40, z: -20, w: 10, d: 5, rot: 0 },
  { id: 'j2', type: 'jump', x: 40, z: 20, w: 10, d: 5, rot: 0 },
  { id: 'j3', type: 'jump', x: -6, z: 0, w: 7, d: 20, rotZ: Math.PI/8, rotX: 0 },
  { id: 'j4', type: 'jump', x: 6, z: 0, w: 7, d: 20, rotZ: -Math.PI/8, rotX: 0 },
  // Mud pits
  { id: 'm1', type: 'mud', x: 0, z: -30, w: 30, d: 20, rot: 0 },
  { id: 'm2', type: 'mud', x: 0, z: 30, w: 30, d: 20, rot: 0 },
  // Corridors / Walls
  { id: 'w1', type: 'wall', x: 0, z: 0, w: 5, d: 40, rot: 0 },
  // Boosts
  { id: 'b1', type: 'boost', x: 0, z: -10, w: 5, d: 10, rot: 0 },
  { id: 'b2', type: 'boost', x: 0, z: 10, w: 5, d: 10, rot: 0 }
];
const scores = { red: 0, blue: 0 };
let gameState = 'PAUSED';

function getNonBotCount() {
    let count = 0;
    for (let id in players) {
        if (!players[id].isBot) count++;
    }
    return count;
}

const MAP_WIDTH = 200;
const MAP_HEIGHT = 100;

function spawnGem(x, z) {
  const g = {
    id: Math.random().toString(36).substr(2, 9),
    x: x !== undefined ? x : (Math.random() - 0.5) * 40,
    z: z !== undefined ? z : (Math.random() - 0.5) * 80
  };
  gems.push(g);
  return g;
}

// init 10 gems
for(let i=0; i<10; i++) spawnGem();

function respawnAfterDelay(count = 1) {
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const newGem = spawnGem();
      io.emit('gem_spawned', newGem);
    }, 5000);
  }
}

let lightnings = [];
function spawnLightning() {
  const L = {
    id: Math.random().toString(36).substr(2, 9),
    x: (Math.random() - 0.5) * 120,
    z: (Math.random() - 0.5) * 60
  };
  lightnings.push(L);
  return L;
}
// init 3 lightnings
for(let i=0; i<3; i++) spawnLightning();

let teamAssignToggle = 0;

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);
  
  // Assign team (0 for red/left, 1 for blue/right)
  const team = teamAssignToggle % 2 === 0 ? 'red' : 'blue';
  teamAssignToggle++;

  const nonBotsBefore = getNonBotCount();

  players[socket.id] = {
    name: '', // assigned later
    x: team === 'red' ? -80 : 80,
    y: 0,
    z: (Math.random() - 0.5) * 20,
    rotation: team === 'red' ? -Math.PI/2 : Math.PI/2,
    team: team,
    score: 0,
    gemCount: 0,
    isBot: false
  };

  if (nonBotsBefore === 0) {
      gameState = 'PLAYING';
      doRestartGame();
  }

  // Send current state to new player
  socket.emit('init', { id: socket.id, players, gems, lightnings, obstacles, scores });
  
  // Tell everyone else about new player
  socket.broadcast.emit('player_join', { id: socket.id, player: players[socket.id] });

  socket.on('move', (data) => {
    if(players[socket.id]) {
      players[socket.id].x = data.x;
      players[socket.id].y = data.y;
      players[socket.id].z = data.z;
      players[socket.id].rotation = data.rotation;
      // Do NOT trust the client's gemCount here, server is the source of truth
      
      // broadcast to everyone else
      socket.broadcast.emit('player_moved', { id: socket.id, ...players[socket.id] });
    }
  });

  socket.on('collect_gem', (gemId) => {
    const gemIndex = gems.findIndex(g => g.id === gemId);
    if (gemIndex !== -1 && players[socket.id] && players[socket.id].gemCount < 5) {
      gems.splice(gemIndex, 1);
      players[socket.id].gemCount++;
      io.emit('gem_collected', { gemId, playerId: socket.id, gemCount: players[socket.id].gemCount });
    }
  });

  socket.on('score', () => {
    if (gameState !== 'PLAYING') return;
    if (players[socket.id] && players[socket.id].gemCount > 0) {
      const team = players[socket.id].team;
      const count = players[socket.id].gemCount;
      scores[team] += count;
      players[socket.id].gemCount = 0;
      io.emit('score_update', scores);
      io.emit('gem_count_update', { playerId: socket.id, gemCount: 0 });
      checkWin();
      respawnAfterDelay(count);
    }
  });

  socket.on('bump_player', (hitId) => {
    if (players[socket.id] && players[hitId] && players[hitId].gemCount > 0) {
        const count = players[hitId].gemCount;
        players[hitId].gemCount = 0;
        io.emit('gem_count_update', { playerId: hitId, gemCount: 0 });
        
        // Spawn popped gems
        for(let i=0; i<count; i++) {
           const angle = Math.random() * Math.PI * 2;
           const newGem = spawnGem(players[hitId].x, players[hitId].z);
           newGem.vx = Math.cos(angle) * 20;
           newGem.vz = Math.sin(angle) * 20;
           newGem.vy = 20 + Math.random() * 10;
           io.emit('gem_spawned', newGem);
        }
    }
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    const gc = players[socket.id] ? players[socket.id].gemCount : 0;
    delete players[socket.id];
    if (getNonBotCount() === 0) {
        gameState = 'PAUSED';
    }
    if (gc > 0) respawnAfterDelay(gc);
    io.emit('player_leave', socket.id);
  });

  socket.on('toggle_ai', (targetId) => {
    if (players[targetId]) {
      const wasBot = players[targetId].isBot;
      players[targetId].isBot = !wasBot;
      
      const nonBotsAfter = getNonBotCount();
      if (wasBot && nonBotsAfter === 1) {
          gameState = 'PLAYING';
          doRestartGame();
      } else if (!wasBot && nonBotsAfter === 0) {
          gameState = 'PAUSED';
      }

      io.emit('player_update', players);
    }
  });

  socket.on('set_name', (name) => {
    if (players[socket.id]) {
      // sanitize name just slightly
      players[socket.id].name = name.trim().substring(0, 20);
      io.emit('player_update', players);
    }
  });

  socket.on('switch_team', (targetId) => {
    if (players[targetId]) {
      const p = players[targetId];
      // Switch team mapping
      p.team = p.team === 'red' ? 'blue' : 'red';
      
      // Reset variables and swap coordinates
      const gc = p.gemCount;
      p.gemCount = 0;
      p.x = p.team === 'red' ? -80 : 80;
      p.y = 0;
      p.z = (Math.random() - 0.5) * 20;
      p.rotation = p.team === 'red' ? -Math.PI/2 : Math.PI/2;
      p.speed = 0;
      if (p.vy !== undefined) p.vy = 0;
      
      if (gc > 0) respawnAfterDelay(gc);
      
      // Tell clients to rerender
      io.emit('team_switched', { id: targetId, player: p });
    }
  });

  socket.on('spawn_ai', (team) => {
    const id = 'bot_' + team + '_' + Math.random().toString(36).substr(2, 5);
    const botNames = ["Bot Digger", "Bot Slinger", "Bot Crusher", "Bot Shaker", "Bot Loco", "Bot Mutt", "Bot Zombie", "Bot Earth", "Bot Swamp", "Bot Avenger", "Auto Hunter", "Cyber Dragon", "Mecha Cruiser", "Iron AI"];
    players[id] = {
      name: botNames[Math.floor(Math.random() * botNames.length)],
      x: team === 'red' ? -80 : 80,
      y: 0,
      z: (Math.random() - 0.5) * 20,
      rotation: team === 'red' ? -Math.PI/2 : Math.PI/2,
      team: team,
      score: 0,
      gemCount: 0,
      speed: 0,
      isBot: true
    };
    io.emit('player_join', { id: id, player: players[id] });
    io.emit('player_update', players);
  });

  socket.on('restart_server', () => {
    console.log("Client requested server restart. Exiting process.");
    process.exit(1);
  });

  socket.on('trigger_lightning', (lId) => {
      triggerLightning(socket.id, lId);
  });


  socket.on('restart_game', () => {
    doRestartGame();
  });
});

function doRestartGame() {
    scores.red = 0;
    scores.blue = 0;
    gems.length = 0; 
    for(let i=0; i<10; i++) spawnGem();
    lightnings.length = 0;
    for(let i=0; i<3; i++) spawnLightning();
    
    for(let id in players) {
       const p = players[id];
       p.x = p.team === 'red' ? -80 : 80;
       p.y = 0;
       p.z = (Math.random() - 0.5) * 20;
       p.rotation = p.team === 'red' ? -Math.PI/2 : Math.PI/2;
       p.gemCount = 0;
       p.speed = 0;
    }
    io.emit('game_restarted', { players, gems, scores, lightnings });
}

function checkWin() {
    if (scores.red >= 100 || scores.blue >= 100) {
         gameState = 'GAMEOVER';
         const winner = scores.red >= 100 ? 'RED' : 'BLUE';
         io.emit('game_over', { winner });
         
         let count = 10;
         const interval = setInterval(() => {
            count--;
            if (count > 0) {
               io.emit('countdown', count);
            } else {
               clearInterval(interval);
               doRestartGame();
               if (getNonBotCount() > 0) {
                   gameState = 'PLAYING';
               } else {
                   gameState = 'PAUSED';
               }
            }
         }, 1000);
    }
}

// --- AI BOT LOGIC ---
const botTurnSpeed = 3.55;
const botMaxSpeed = 37.87;
const botAccel = 64.18;
let lastBotTime = Date.now();

function triggerLightning(playerId, lId) {
    const idx = lightnings.findIndex(l => l.id === lId);
    if (idx !== -1 && players[playerId]) {
        const L = lightnings.splice(idx, 1)[0];
        
        const explosionRadius = 40;
        for (let targetId in players) {
            if (targetId === playerId) continue;
            const p = players[targetId];
            const dist = Math.sqrt((p.x - L.x)**2 + (p.z - L.z)**2);
            if (dist < explosionRadius) {
                const count = p.gemCount;
                p.gemCount = 0;
                io.emit('gem_count_update', { playerId: targetId, gemCount: 0 });
                
                for(let i=0; i<count; i++) {
                   const angle = Math.random() * Math.PI * 2;
                   const newGem = spawnGem(p.x, p.z);
                   newGem.vx = Math.cos(angle) * 20;
                   newGem.vz = Math.sin(angle) * 20;
                   newGem.vy = 20 + Math.random() * 10;
                   io.emit('gem_spawned', newGem);
                }
                
                const angle = Math.atan2(p.x - L.x, p.z - L.z);
                const force = (explosionRadius - dist) * 1.5; 
                
                if (!targetId.startsWith('bot_')) {
                    io.to(targetId).emit('thrown', { vx: Math.sin(angle) * force, vz: Math.cos(angle) * force, vy: 30 + force });
                } else {
                    p.speed = force * 2;
                    p.rotation = angle;
                    p.vy = 30 + force;
                }
            }
        }
        io.emit('lightning_exploded', { id: lId, x: L.x, z: L.z });
        setTimeout(() => {
            const newL = spawnLightning();
            io.emit('lightning_spawned', newL);
        }, 10000);
    }
}

// --- AI BOT PATHFINDING ---
const GRID_SIZE = 5;
const gridW = Math.floor(200 / GRID_SIZE);
const gridH = Math.floor(100 / GRID_SIZE);

function getGridCoords(x, z) {
  let gx = Math.floor((x + 100) / GRID_SIZE);
  let gz = Math.floor((z + 50) / GRID_SIZE);
  return { gx: Math.max(0, Math.min(gridW - 1, gx)), gz: Math.max(0, Math.min(gridH - 1, gz)) };
}
function getWorldCoords(gx, gz) {
  return { x: gx * GRID_SIZE - 100 + GRID_SIZE / 2, z: gz * GRID_SIZE - 50 + GRID_SIZE / 2 };
}

let AGrid = [];
for (let x = 0; x < gridW; x++) {
  let col = [];
  for (let z = 0; z < gridH; z++) col.push(1);
  AGrid.push(col);
}

for (let obs of obstacles) {
  if (obs.type === 'boost') continue;
  const sx = Math.max(0, Math.floor((obs.x - obs.w/2 + 100) / GRID_SIZE));
  const ex = Math.min(gridW - 1, Math.floor((obs.x + obs.w/2 + 100) / GRID_SIZE));
  const sz = Math.max(0, Math.floor((obs.z - obs.d/2 + 50) / GRID_SIZE));
  const ez = Math.min(gridH - 1, Math.floor((obs.z + obs.d/2 + 50) / GRID_SIZE));
  
  for(let x = sx; x <= ex; x++) {
    for(let z = sz; z <= ez; z++) {
      if (obs.type === 'wall') AGrid[x][z] = 1000;
      else if (obs.type === 'mud') AGrid[x][z] = 5;
    }
  }
}

function findPath(sx, sz, ex, ez) {
  if (sx === ex && sz === ez) return [];
  let open = [{ x: sx, z: sz, g: 0, f: 0, parent: null }];
  let closed = new Set();
  while (open.length > 0) {
    let curr = open.reduce((min, node) => node.f < min.f ? node : min, open[0]);
    open.splice(open.indexOf(curr), 1);
    
    let key = curr.x + ',' + curr.z;
    if (closed.has(key)) continue;
    closed.add(key);
    
    if (curr.x === ex && curr.z === ez) {
      let path = [];
      let step = curr;
      while (step.parent) {
        path.push({ x: step.x, z: step.z });
        step = step.parent;
      }
      return path.reverse();
    }
    
    let neighbors = [
      {x: curr.x+1, z: curr.z}, {x: curr.x-1, z: curr.z},
      {x: curr.x, z: curr.z+1}, {x: curr.x, z: curr.z-1}
    ];
    
    for (let n of neighbors) {
      if (n.x >= 0 && n.x < gridW && n.z >=0 && n.z < gridH) {
        let cost = AGrid[n.x][n.z];
        if (cost >= 1000) continue; 
        let g = curr.g + cost;
        let h = Math.abs(n.x - ex) + Math.abs(n.z - ez);
        open.push({ x: n.x, z: n.z, g: g, f: g + h, parent: curr });
      }
    }
  }
  return [];
}

// Init one bot on the blue team
players['bot_blue_1'] = {
  name: "Bot Shaker",
  team: 'blue',
  x: 80, y: 0, z: 20,
  rotation: Math.PI/2,
  gemCount: 0,
  score: 0,
  speed: 0,
  isBot: true
};

function updateBots() {
  if (gameState !== 'PLAYING') return;
  const now = Date.now();
  const dt = Math.min((now - lastBotTime) / 1000, 0.1);
  lastBotTime = now;

  const gravity = 80;
  for (let g of gems) {
      if (g.vy !== undefined) {
          g.x += g.vx * dt;
          g.z += g.vz * dt;
          g.y = (g.y || 1.5) + g.vy * dt;
          g.vy -= gravity * dt;
          if (g.y <= 1.5) {
             g.y = 1.5;
             delete g.vy; delete g.vx; delete g.vz;
          }
      }
  }

  for (let id in players) {
    const bot = players[id];
    if (!bot.isBot) continue;

    let targetX = 0, targetZ = 0;
    let enemyNear = null;
    let enemyDist = Infinity;

    for (let eid in players) {
      if (eid === id) continue;
      const e = players[eid];
      if (e.team === bot.team) continue;
      const dSquare = (e.x - bot.x) ** 2 + (e.z - bot.z) ** 2;
      if (dSquare < enemyDist) {
        enemyDist = dSquare;
        enemyNear = e;
        enemyNear.id = eid;
      }
    }

    // LIGHTNING STRATEGY
    let bestLightning = null;
    let bestLightningScore = 0;
    for (let L of lightnings) {
        let enemyHit = 0;
        let allyHit = 0;
        for (let eid in players) {
            if (eid === id) continue;
            let p = players[eid];
            if ((p.x - L.x)**2 + (p.z - L.z)**2 < 1600) { 
                if (p.team !== bot.team && p.gemCount > 0) enemyHit += p.gemCount;
                else if (p.team === bot.team) allyHit++;
            }
        }
        let score = enemyHit - allyHit * 2;
        if (score > 0 && score > bestLightningScore) {
            bestLightningScore = score;
            bestLightning = L;
        }
    }

    // STATE EVALUATION
    let state = 'seek_gem';
    if (bestLightning) {
        state = 'seek_lightning';
    } else if (enemyNear && enemyDist < 360.11) { // inside ~19 units
      if (enemyNear.gemCount > 0 && bot.gemCount === 0) state = 'attack';
      else if (bot.gemCount > 0) state = 'flee';
    } 
    
    // Override if full or gems are empty
    if (bot.gemCount >= 5 || (bot.gemCount > 0 && gems.filter(g => g.vy === undefined).length === 0)) {
      state = 'return_base';
    }

    // TARGET ASSIGNMENT
    if (state === 'return_base') {
      targetX = bot.team === 'red' ? -80 : 80;
      targetZ = 0;
    } else if (state === 'seek_gem') {
      let closestGem = null;
      let gemDist = Infinity;
      for (let g of gems) {
        if (g.vy !== undefined) continue;
        const d = (g.x - bot.x) ** 2 + (g.z - bot.z) ** 2;
        if (d < gemDist) { gemDist = d; closestGem = g; }
      }
      if (closestGem) {
        targetX = closestGem.x; targetZ = closestGem.z;
      } else {
        targetX = bot.team === 'red' ? -80 : 80; targetZ = 0;
      }
    } else if (state === 'seek_lightning') {
      targetX = bestLightning.x; targetZ = bestLightning.z;
    } else if (state === 'attack') {
      targetX = enemyNear.x; targetZ = enemyNear.z;
    } else if (state === 'flee') {
      const angleAway = Math.atan2(bot.x - enemyNear.x, bot.z - enemyNear.z);
      targetX = bot.x + Math.sin(angleAway) * 20;
      targetZ = bot.z + Math.cos(angleAway) * 20;
    }

    // A* PATHFINDING AND STEERING
    if (!bot.pathTimer) bot.pathTimer = 0;
    bot.pathTimer -= dt;
    if (bot.pathTimer <= 0 || !bot.targetX || Math.abs(bot.targetX - targetX) > 10 || Math.abs(bot.targetZ - targetZ) > 10) {
        let sc = getGridCoords(bot.x, bot.z);
        let ec = getGridCoords(targetX, targetZ);
        bot.path = findPath(sc.gx, sc.gz, ec.gx, ec.gz);
        bot.pathTimer = 0.5; // Evaluate every 0.5s
        bot.targetX = targetX;
        bot.targetZ = targetZ;
        if (bot.path.length === 0) {
            bot.nextX = targetX; bot.nextZ = targetZ;
        }
    }
    
    if (bot.path && bot.path.length > 0) {
        let nextNode = bot.path[0];
        let wc = getWorldCoords(nextNode.x, nextNode.z);
        bot.nextX = wc.x; bot.nextZ = wc.z;
        let distSq = (bot.x - wc.x)**2 + (bot.z - wc.z)**2;
        if (distSq < 25) {
            bot.path.shift();
            if (bot.path.length > 0) {
                nextNode = bot.path[0];
                wc = getWorldCoords(nextNode.x, nextNode.z);
                bot.nextX = wc.x; bot.nextZ = wc.z;
            } else {
                bot.nextX = targetX; bot.nextZ = targetZ;
            }
        }
    } else {
        bot.nextX = targetX; bot.nextZ = targetZ;
    }

    const dx = bot.nextX - bot.x;
    const dz = bot.nextZ - bot.z;
    let desiredAngle = Math.atan2(dx, dz);

    let angleDiff = desiredAngle - bot.rotation;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    if (angleDiff > 0.1) bot.rotation += botTurnSpeed * dt;
    else if (angleDiff < -0.1) bot.rotation -= botTurnSpeed * dt;

    if (!bot.speed) bot.speed = 0;
    const absDiff = Math.abs(angleDiff);
    const targetSpeed = absDiff > 1.0 ? botMaxSpeed * 0.3 : botMaxSpeed;

    if (bot.speed < targetSpeed) bot.speed = Math.min(bot.speed + botAccel * dt, targetSpeed);
    else bot.speed = Math.max(bot.speed - botAccel * dt, targetSpeed);

    bot.x += Math.sin(bot.rotation) * bot.speed * dt;
    bot.z += Math.cos(bot.rotation) * bot.speed * dt;

    let hittingWall = false;
    for (let obs of obstacles) {
      const hw = obs.w / 2;
      const hd = obs.d / 2;
      const inX = bot.x > obs.x - hw && bot.x < obs.x + hw;
      const inZ = bot.z > obs.z - hd && bot.z < obs.z + hd;

      if (inX && inZ) {
        if (obs.type === 'mud' && bot.y <= 0.1) {
          bot.speed *= 0.8; 
        } else if (obs.type === 'jump' && bot.y <= 0.5) {
          if (bot.speed > 20 && bot.vy <= 0) bot.vy = 35;
        } else if (obs.type === 'wall' && bot.y < 3) {
          hittingWall = true;
        }
      }
    }

    if (hittingWall) {
      bot.speed = -bot.speed * 0.5;
      bot.x -= Math.sin(bot.rotation) * 2;
      bot.z -= Math.cos(bot.rotation) * 2;
    }

    bot.x = Math.max(-95, Math.min(95, bot.x));
    bot.z = Math.max(-45, Math.min(45, bot.z));

    // GEM COLLECTION
    if (bot.gemCount < 5) {
      for (let i = 0; i < gems.length; i++) {
        const g = gems[i];
        if (g.vy !== undefined) continue;
        if ((g.x - bot.x) ** 2 + (g.z - bot.z) ** 2 < 16) {
          gems.splice(i, 1);
          bot.gemCount++;
          io.emit('gem_collected', { gemId: g.id, playerId: id, gemCount: bot.gemCount });
          break;
        }
      }
    }

    // BASE SCORING
    const isRedBase = bot.team === 'red' && bot.x < -60 && Math.abs(bot.z) < 20;
    const isBlueBase = bot.team === 'blue' && bot.x > 60 && Math.abs(bot.z) < 20;
    if ((isRedBase || isBlueBase) && bot.gemCount > 0) {
      const gc = bot.gemCount;
      scores[bot.team] += gc;
      bot.gemCount = 0;
      io.emit('score_update', scores);
      io.emit('gem_count_update', { playerId: id, gemCount: 0 });
      checkWin();
      respawnAfterDelay(gc);
    }

    // ATTACK COLLISION
    if (enemyNear && Math.abs(bot.speed) > 25 && enemyDist < 10 && enemyNear.gemCount > 0) {
      const count = enemyNear.gemCount;
      enemyNear.gemCount = 0;
      io.emit('gem_count_update', { playerId: enemyNear.id, gemCount: 0 });
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const newGem = spawnGem(enemyNear.x, enemyNear.z);
        newGem.vx = Math.cos(angle) * 20;
        newGem.vz = Math.sin(angle) * 20;
        newGem.vy = 20 + Math.random() * 10;
        io.emit('gem_spawned', newGem);
      }
      bot.speed *= -0.5;
    }

    // JUMP & GRAVITY physics for bots
    if (!bot.vy) bot.vy = 0;
    bot.y += bot.vy * dt;
    if (bot.y > 0) bot.vy -= 80 * dt;
    else { bot.y = 0; bot.vy = 0; }

    // LIGHTNING TRIGGER
    for (let i = 0; i < lightnings.length; i++) {
        let L = lightnings[i];
        if ((bot.x - L.x)**2 + (bot.z - L.z)**2 < 25 && bot.y < 4) {
            triggerLightning(id, L.id);
            break; 
        }
    }

    io.emit('player_moved', { id: id, x: bot.x, y: bot.y, z: bot.z, rotation: bot.rotation, gemCount: bot.gemCount });
  }
}
setInterval(updateBots, 1000 / 30);

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
