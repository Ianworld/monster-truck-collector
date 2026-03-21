
const MAP_WIDTH = 200;
const MAP_HEIGHT = 100;

function runMatch(paramsRed, paramsBlue) {
  let gems = [];
  function spawnGem(x, z) {
    const g = { id: Math.random().toString(), x: x !== undefined ? x : (Math.random() - 0.5) * 40, z: z !== undefined ? z : (Math.random() - 0.5) * 80 };
    gems.push(g); return g;
  }
  for(let i=0; i<10; i++) spawnGem();

  let players = {
    'red': { team: 'red', x: -80, y: 0, z: 20, rotation: -Math.PI/2, gemCount: 0, score: 0, speed: 0 },
    'blue': { team: 'blue', x: 80, y: 0, z: -20, rotation: Math.PI/2, gemCount: 0, score: 0, speed: 0 }
  };

  let scores = { red: 0, blue: 0 };
  let botParams = { 'red': paramsRed, 'blue': paramsBlue };
  const dt = 1/30;

  for(let frame=0; frame<1800; frame++) { // 60 seconds match
    const ids = ['red', 'blue'];
    for (let id of ids) {
      const bot = players[id];
      const params = botParams[id];
      let targetX = 0, targetZ = 0;
      let enemy = players[id === 'red' ? 'blue' : 'red'];
      
      const enemyDist = (enemy.x - bot.x) ** 2 + (enemy.z - bot.z) ** 2;

      let state = 'seek_gem';
      if (enemyDist < params.fleeRadius) {
        if (enemy.gemCount > 0 && bot.gemCount === 0) state = 'attack';
        else if (bot.gemCount > 0) state = 'flee';
      } 
      
      if (bot.gemCount >= 5 || (bot.gemCount > 0 && gems.filter(g => g.vy === undefined).length === 0)) {
        state = 'return_base';
      }

      if (state === 'return_base') {
        targetX = bot.team === 'red' ? -80 : 80; targetZ = 0;
      } else if (state === 'seek_gem') {
        let closestGem = null; let gemDistSq = Infinity;
        for (let g of gems) {
          if (g.vy !== undefined) continue;
          const d = (g.x - bot.x) ** 2 + (g.z - bot.z) ** 2;
          if (d < gemDistSq) { gemDistSq = d; closestGem = g; }
        }
        if (closestGem) { targetX = closestGem.x; targetZ = closestGem.z; }
        else { targetX = bot.team === 'red' ? -80 : 80; targetZ = 0; }
      } else if (state === 'attack') {
        targetX = enemy.x; targetZ = enemy.z;
      } else if (state === 'flee') {
        const angleAway = Math.atan2(bot.x - enemy.x, bot.z - enemy.z);
        targetX = bot.x + Math.sin(angleAway) * 20; targetZ = bot.z + Math.cos(angleAway) * 20;
      }

      const dx = targetX - bot.x; const dz = targetZ - bot.z;
      let desiredAngle = Math.atan2(dx, dz);
      let angleDiff = desiredAngle - bot.rotation;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

      if (angleDiff > 0.1) bot.rotation += params.turnSpeed * dt;
      else if (angleDiff < -0.1) bot.rotation -= params.turnSpeed * dt;

      const absDiff = Math.abs(angleDiff);
      const targetSpeed = absDiff > 1.0 ? params.maxSpeed * 0.3 : params.maxSpeed;

      if (bot.speed < targetSpeed) bot.speed = Math.min(bot.speed + params.accel * dt, targetSpeed);
      else bot.speed = Math.max(bot.speed - params.accel * dt, targetSpeed);

      bot.x += Math.sin(bot.rotation) * bot.speed * dt; bot.z += Math.cos(bot.rotation) * bot.speed * dt;
      bot.x = Math.max(-95, Math.min(95, bot.x)); bot.z = Math.max(-45, Math.min(45, bot.z));

      if (bot.gemCount < 5) {
        for (let i = 0; i < gems.length; i++) {
          const g = gems[i];
          if (g.vy !== undefined) continue;
          if ((g.x - bot.x) ** 2 + (g.z - bot.z) ** 2 < 16) {
            gems.splice(i, 1); bot.gemCount++;
            spawnGem(); // auto respawn
            break;
          }
        }
      }

      const isRedBase = bot.team === 'red' && bot.x < -60 && Math.abs(bot.z) < 20;
      const isBlueBase = bot.team === 'blue' && bot.x > 60 && Math.abs(bot.z) < 20;
      if ((isRedBase || isBlueBase) && bot.gemCount > 0) {
        scores[bot.team] += bot.gemCount; bot.gemCount = 0;
      }

      if (Math.abs(bot.speed) > 25 && enemyDist < params.attackDist && enemy.gemCount > 0) {
        const count = enemy.gemCount; enemy.gemCount = 0;
        for (let i = 0; i < count; i++) {
          const newGem = spawnGem(enemy.x, enemy.z);
          newGem.vy = 0; delete newGem.vy; // immediate drop
        }
        bot.speed *= -0.5;
        scores[bot.team] += 1; // reward for attacking
      }
    }
  }
  return scores;
}

function mutate(params) {
  const p = { ...params };
  const r = Math.random();
  if (r < 0.2) p.turnSpeed += (Math.random() - 0.5) * 1.0;
  else if (r < 0.4) p.maxSpeed += (Math.random() - 0.5) * 10;
  else if (r < 0.6) p.accel += (Math.random() - 0.5) * 20;
  else if (r < 0.8) p.fleeRadius += (Math.random() - 0.5) * 100;
  else p.attackDist += (Math.random() - 0.5) * 10;
  
  // Constrain
  p.turnSpeed = Math.max(1.0, Math.min(p.turnSpeed, 5.0));
  p.maxSpeed = Math.max(20, Math.min(p.maxSpeed, 70));
  p.accel = Math.max(20, Math.min(p.accel, 150));
  p.fleeRadius = Math.max(100, Math.min(p.fleeRadius, 800));
  p.attackDist = Math.max(10, Math.min(p.attackDist, 50));
  return p;
}

let bestParams = { turnSpeed: 2.5, maxSpeed: 35, accel: 60, fleeRadius: 400, attackDist: 16 };
let bestScore = 0;

console.log("Starting evolutionary self-play...");
for (let gen = 1; gen <= 50; gen++) {
  const mutated = mutate(bestParams);
  // Red = Best, Blue = Mutated
  const result = runMatch(bestParams, mutated);
  let winner = "Tie";
  if (result.blue > result.red) {
    bestParams = mutated;
    bestScore = result.blue;
    winner = "Mutated (Blue)";
  } else if (result.red > result.blue) {
    bestScore = result.red;
    winner = "Current Best (Red)";
  }
  
  if (gen % 5 === 0) {
     console.log(`Generation ${gen} Winner: ${winner}. Best Score: ${bestScore}. Best Params:`, bestParams);
  }
}

console.log("\nFINISHED TRAINING! Final Best Parameters:");
console.log(bestParams);
