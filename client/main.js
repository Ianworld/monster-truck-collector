import * as THREE from 'three';
import { io } from 'socket.io-client';

// AUDIO SYNTHESIS
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const masterGain = audioCtx.createGain();
masterGain.gain.value = 0.5; // default volume
masterGain.connect(audioCtx.destination);

let engineOsc;
let engineGain;
let audioInit = false;

window.addEventListener('keydown', () => {
  if (!audioInit) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    engineOsc = audioCtx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 50;
    engineGain = audioCtx.createGain();
    engineGain.gain.value = 0.05; // low hum
    engineOsc.connect(engineGain);
    engineGain.connect(masterGain);
    engineOsc.start();
    audioInit = true;
    playAudio('start');
  }
}, { once: true });

function playAudio(type) {
  if (!audioInit || audioCtx.state === 'suspended') return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(masterGain);
  const now = audioCtx.currentTime;

  if (type === 'jump') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.3);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.3);
  } else if (type === 'collect') {
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.setValueAtTime(1200, now + 0.1);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    osc.start(now);
    osc.stop(now + 0.2);
  } else if (type === 'score') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.setValueAtTime(600, now + 0.1);
    osc.frequency.setValueAtTime(800, now + 0.2);
    osc.frequency.setValueAtTime(1000, now + 0.3);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
    osc.start(now);
    osc.stop(now + 0.6);
  } else if (type === 'bump') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(100, now);
    osc.frequency.exponentialRampToValueAtTime(10, now + 0.2);
    gain.gain.setValueAtTime(0.8, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
    osc.start(now);
    osc.stop(now + 0.2);
  } else if (type === 'start') {
    osc.type = 'square';
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.setValueAtTime(880, now + 0.2);
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
    osc.start(now);
    osc.stop(now + 0.6);
  }
}


// SETUP THREE.JS
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);

const aspect = window.innerWidth / window.innerHeight;
const viewSize = 100;
const camera = new THREE.OrthographicCamera(-viewSize * aspect / 2, viewSize * aspect / 2, viewSize / 2, -viewSize / 2, 0.1, 1000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.getElementById('app').appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(50, 100, 50);
dirLight.castShadow = true;
dirLight.shadow.camera.left = -100;
dirLight.shadow.camera.right = 100;
dirLight.shadow.camera.top = 100;
dirLight.shadow.camera.bottom = -100;
scene.add(dirLight);

// GAME CONSTANTS & STATE
const MAP_WIDTH = 200;
const MAP_HEIGHT = 100;

let socket;
let myId = null;
let myTeam = null;
let myGemCount = 0;
let myBoosts = 5;
let maxBoosts = 5;
let lastSpacePress = false;

let players = {};
let playerMeshes = {};
let gems = [];
let gemMeshes = {};
let lightnings = [];
let lightningMeshes = {};
let obstacles = [];
let obstacleMeshes = [];
let scores = { red: 0, blue: 0 };
let redScoreGems = [];
let blueScoreGems = [];

const keys = { w: false, a: false, s: false, d: false, space: false };

// ENVIRONMENT BUILD
function buildEnvironment() {
  const groundGeo = new THREE.PlaneGeometry(MAP_WIDTH, MAP_HEIGHT);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x55aa55 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const redBaseGeo = new THREE.BoxGeometry(40, 0.5, 40);
  const redBaseMat = new THREE.MeshLambertMaterial({ color: 0xaa3333 });
  const redBase = new THREE.Mesh(redBaseGeo, redBaseMat);
  redBase.position.set(-80, 0.25, 0);
  redBase.receiveShadow = true;
  scene.add(redBase);

  const blueBaseGeo = new THREE.BoxGeometry(40, 0.5, 40);
  const blueBaseMat = new THREE.MeshLambertMaterial({ color: 0x3366aa });
  const blueBase = new THREE.Mesh(blueBaseGeo, blueBaseMat);
  blueBase.position.set(80, 0.25, 0);
  blueBase.receiveShadow = true;
  scene.add(blueBase);

  // const gridHelper = new THREE.GridHelper(200, 20);
  // scene.add(gridHelper);
}

function buildObstacles(obsts) {
  obsts.forEach(obs => {
    let geo, mat, yPos;
    if (obs.type === 'jump') {
      geo = new THREE.BoxGeometry(obs.w, 2, obs.d);
      mat = new THREE.MeshLambertMaterial({ color: 0xdd8822 });
      yPos = 0;
    } else if (obs.type === 'mud') {
      geo = new THREE.BoxGeometry(obs.w, 0.2, obs.d);
      mat = new THREE.MeshLambertMaterial({ color: 0x4a3b2c });
      yPos = 0.1;
    } else if (obs.type === 'boost') {
      geo = new THREE.BoxGeometry(obs.w, 0.2, obs.d);
      mat = new THREE.MeshLambertMaterial({ color: 0xffff00 });
      yPos = 0.1;
    } else if (obs.type === 'wall') {
      geo = new THREE.BoxGeometry(obs.w, 4, obs.d);
      mat = new THREE.MeshLambertMaterial({ color: 0x888888 });
      yPos = 2;
    }

    if (geo && mat) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(obs.x, yPos, obs.z);
      if (obs.type === 'jump') {
        mesh.position.y = 1;
        if (obs.rotX !== undefined) mesh.rotation.x = obs.rotX;
        else mesh.rotation.x = obs.x < 0 ? Math.PI / 8 : -Math.PI / 8;
        if (obs.rotZ !== undefined) mesh.rotation.z = obs.rotZ;
        else if (obs.x < 0) mesh.rotation.z = -Math.PI / 8;
      }
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      scene.add(mesh);
      obstacleMeshes.push(mesh);
    }
  });
}

function spawnGemMesh(gem) {
  if (gemMeshes[gem.id]) return; // prevent dupes
  const geo = new THREE.OctahedronGeometry(1.5);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffd700, emissive: 0xaa8800 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(gem.x, 1.5, gem.z);
  mesh.castShadow = true;
  scene.add(mesh);
  gemMeshes[gem.id] = mesh;
}

function removeGemMesh(gemId) {
  if (gemMeshes[gemId]) {
    scene.remove(gemMeshes[gemId]);
    delete gemMeshes[gemId];
  }
}

function spawnLightningMesh(l) {
  if (lightningMeshes[l.id]) return;
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffff00, emissive: 0x88ccff });
  const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3, 0.5), mat);
  p1.position.set(-0.5, 1.5, 0); p1.rotation.z = 0.3;
  const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3, 0.5), mat);
  p2.position.set(0.5, -1, 0); p2.rotation.z = 0.3;
  group.add(p1); group.add(p2);
  group.position.set(l.x, 3, l.z);
  scene.add(group);
  lightningMeshes[l.id] = group;
}

function createExplosionParticles(x, y, z) {
  for (let i = 0; i < 30; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true }));
    p.position.set(x, y + 2, z);
    const ang = Math.random() * Math.PI * 2;
    p.userData = {
      vx: Math.sin(ang) * (20 + Math.random() * 30),
      vy: 10 + Math.random() * 30,
      vz: Math.cos(ang) * (20 + Math.random() * 30),
      life: 1.0
    };
    scene.add(p);
    particles.push(p);
  }
}

// CREATE TRUCK MESH
function createTruckMesh(colorName, gemCount = 0) {
  const group = new THREE.Group();

  const bodyColor = colorName === 'red' ? 0xff3333 : 0x33aaff;
  const bodyGeo = new THREE.BoxGeometry(4, 2, 8);
  const bodyMat = new THREE.MeshLambertMaterial({ color: bodyColor });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 2;
  body.castShadow = true;
  group.add(body);

  const cabGeo = new THREE.BoxGeometry(3, 2, 3);
  const cabMat = new THREE.MeshLambertMaterial({ color: 0xdddddd });
  const cab = new THREE.Mesh(cabGeo, cabMat);
  cab.position.set(0, 4, 1);
  cab.castShadow = true;
  group.add(cab);

  // Gem indicators in the bed of the truck (-1 to -3 range)
  const gemGeo = new THREE.OctahedronGeometry(0.8);
  const gemMat = new THREE.MeshLambertMaterial({ color: 0xffd700 });
  for (let i = 0; i < gemCount; i++) {
    const gemMesh = new THREE.Mesh(gemGeo, gemMat);
    // Stack them or layout in grid
    const zPos = -1.5 - (i % 2) * 1.5;
    const xPos = (i % 2 === 0 ? 0.8 : -0.8);
    const yPos = 3.5 + Math.floor(i / 2) * 1.5;
    gemMesh.position.set(xPos, yPos, zPos);
    group.add(gemMesh);
  }

  const wheelGeo = new THREE.CylinderGeometry(1.5, 1.5, 1, 16);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });

  const wPositions = [[-2.5, 1.5, -3], [2.5, 1.5, -3], [-2.5, 1.5, 3], [2.5, 1.5, 3]];

  wPositions.forEach(pos => {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(pos[0], pos[1], pos[2]);
    w.castShadow = true;
    group.add(w);
  });

  return group;
}

function updateScoreGems(team, score) {
  const arr = team === 'red' ? redScoreGems : blueScoreGems;
  const baseX = team === 'red' ? -105 : 105;

  // Add missing gems
  while (arr.length < score) {
    const geo = new THREE.OctahedronGeometry(1.5);
    const matGold = new THREE.MeshLambertMaterial({ color: 0xffd700, emissive: 0xaa8800 });
    const mesh = new THREE.Mesh(geo, matGold);
    mesh.castShadow = true;
    scene.add(mesh);
    arr.push(mesh);
  }
  // Remove extra gems if score goes down (e.g. restart)
  while (arr.length > score) {
    const mesh = arr.pop();
    scene.remove(mesh);
  }
  // Position them
  for (let i = 0; i < arr.length; i++) {
    const pile = Math.floor(i / 10);
    const idx = i % 10;
    const x = baseX;
    const z = -18 + pile * 4;
    const y = 1.5 + idx * 2.5; // Stacking vertically with spacing 2.5
    arr[i].position.set(x, y, z);
  }
}

function updateScores(newScores) {
  scores = newScores;
  document.getElementById('red-score').innerText = `Red Team: ${scores.red}`;
  document.getElementById('blue-score').innerText = `Blue Team: ${scores.blue}`;
  updateScoreGems('red', scores.red);
  updateScoreGems('blue', scores.blue);
}

window.toggleAI = function (id) {
  socket.emit('toggle_ai', id);
};

function renderPlayerList() {
  const container = document.getElementById('player-list');
  if (!container) return;
  container.innerHTML = '';
  for (let id in players) {
    const p = players[id];
    const row = document.createElement('div');
    row.className = 'player-row';

    const displayName = (p.isBot ? '[AI] ' : '') + (p.name || id.substr(0, 5)) + (id === myId ? ' (You)' : '');
    const nameSpan = document.createElement('span');
    nameSpan.innerText = displayName;
    nameSpan.className = p.team === 'red' ? 'red-text' : 'blue-text';
    if (id === myId) nameSpan.classList.add('me-text');
    nameSpan.style.cursor = 'pointer';
    nameSpan.onclick = () => socket.emit('switch_team', id);

    const btn = document.createElement('button');
    btn.innerText = p.isBot ? 'Manual' : 'Autopilot';
    btn.onclick = () => window.toggleAI(id);

    row.appendChild(nameSpan);
    row.appendChild(btn);
    container.appendChild(row);
  }
}

function clearDynamicMeshes() {
    for (let id in gemMeshes) { scene.remove(gemMeshes[id]); }
    gemMeshes = {};
    for (let id in lightningMeshes) { scene.remove(lightningMeshes[id]); }
    lightningMeshes = {};
    for (let id in playerMeshes) { scene.remove(playerMeshes[id]); }
    playerMeshes = {};
}

function clearObstacleMeshes() {
    for (let m of obstacleMeshes) { scene.remove(m); }
    obstacleMeshes = [];
}

// SOCKET & MULTIPLAYER SETUP
function setupNetworking() {
  // Update with your actual server URL once deployed (e.g., Render, Railway, Fly.io)
  const SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : 'https://monster-truck-collector.onrender.com';

  socket = io(SERVER_URL); // Connects to game server


  socket.on('init', (data) => {
    myId = data.id;
    players = data.players;
    myTeam = players[myId].team;
    gems = data.gems;
    lightnings = data.lightnings || [];
    obstacles = data.obstacles || [];

    if (data.scores) updateScores(data.scores);

    clearDynamicMeshes();
    clearObstacleMeshes();

    buildObstacles(obstacles);
    gems.forEach(g => spawnGemMesh(g));
    lightnings.forEach(l => spawnLightningMesh(l));

    for (let id in players) {
      const p = players[id];
      const mesh = createTruckMesh(p.team, p.gemCount);
      mesh.position.set(p.x, p.y, p.z);
      mesh.rotation.y = p.rotation;
      scene.add(mesh);
      playerMeshes[id] = mesh;
    }
    renderPlayerList();
  });

  socket.on('player_join', (data) => {
    players[data.id] = data.player;
    const mesh = createTruckMesh(data.player.team, data.player.gemCount);
    mesh.position.set(data.player.x, data.player.y, data.player.z);
    mesh.rotation.y = data.player.rotation;
    scene.add(mesh);
    playerMeshes[data.id] = mesh;
    renderPlayerList();
  });

  socket.on('player_moved', (data) => {
    if (players[data.id]) {
      players[data.id].x = data.x;
      players[data.id].y = data.y;
      players[data.id].z = data.z;
      players[data.id].rotation = data.rotation;

      if (playerMeshes[data.id]) {
        playerMeshes[data.id].position.set(data.x, data.y, data.z);
        playerMeshes[data.id].rotation.y = data.rotation;
      }
    }
  });

  socket.on('gem_collected', (data) => {
    gems = gems.filter(g => g.id !== data.gemId);
    removeGemMesh(data.gemId);
    if (players[data.playerId]) {
      players[data.playerId].gemCount = data.gemCount;
      if (data.playerId === myId) {
        myGemCount = data.gemCount;
        playAudio('collect');
      }
      scene.remove(playerMeshes[data.playerId]);
      playerMeshes[data.playerId] = createTruckMesh(players[data.playerId].team, data.gemCount);
      scene.add(playerMeshes[data.playerId]);
    }
  });

  socket.on('gem_spawned', (gem) => {
    gems.push(gem);
    spawnGemMesh(gem);
    if (gem.vy !== undefined) playAudio('bump'); // A Popped gem implies bump
  });

  socket.on('score_update', (newScores) => {
    updateScores(newScores);
    playAudio('score');
  });

  socket.on('gem_count_update', (data) => {
    if (players[data.playerId]) {
      players[data.playerId].gemCount = data.gemCount;
      if (data.playerId === myId) myGemCount = data.gemCount;
      scene.remove(playerMeshes[data.playerId]);
      playerMeshes[data.playerId] = createTruckMesh(players[data.playerId].team, data.gemCount);
      scene.add(playerMeshes[data.playerId]);
    }
  });

  socket.on('lightning_spawned', (l) => {
    lightnings.push(l);
    spawnLightningMesh(l);
  });

  socket.on('lightning_exploded', (data) => {
    if (lightningMeshes[data.id]) {
      scene.remove(lightningMeshes[data.id]);
      delete lightningMeshes[data.id];
    }
    lightnings = lightnings.filter(l => l.id !== data.id);
    createExplosionParticles(data.x, 1, data.z);
    playAudio('bump'); // explosion sound
  });

  socket.on('thrown', (data) => {
    yVelocity = data.vy;
    speed = Math.sqrt(data.vx ** 2 + data.vz ** 2) * 2; // massive horizontal speed
    if (players[myId]) players[myId].rotation = Math.atan2(data.vx, data.vz);
    playAudio('jump');
  });

  socket.on('player_leave', (id) => {
    if (playerMeshes[id]) {
      scene.remove(playerMeshes[id]);
      delete playerMeshes[id];
    }
    delete players[id];
    renderPlayerList();
  });

  socket.on('team_switched', (data) => {
    const id = data.id;
    const p = data.player;
    players[id] = p;

    if (id === myId) {
      myTeam = p.team;
      myGemCount = p.gemCount;
      speed = p.speed;
      yVelocity = 0;
    }

    if (playerMeshes[id]) {
      scene.remove(playerMeshes[id]);
    }
    playerMeshes[id] = createTruckMesh(p.team, p.gemCount);
    playerMeshes[id].position.set(p.x, p.y, p.z);
    playerMeshes[id].rotation.y = p.rotation;
    scene.add(playerMeshes[id]);

    renderPlayerList();
    playAudio('start');
  });

  socket.on('game_restarted', (data) => {
    players = data.players;
    myTeam = players[myId].team;
    gems = data.gems;
    lightnings = data.lightnings || [];
    updateScores(data.scores);

    clearDynamicMeshes();

    gems.forEach(g => spawnGemMesh(g));
    lightnings.forEach(l => spawnLightningMesh(l));

    for (let id in players) {
      const p = players[id];
      playerMeshes[id] = createTruckMesh(p.team, p.gemCount);
      playerMeshes[id].position.set(p.x, p.y, p.z);
      playerMeshes[id].rotation.y = p.rotation;
      scene.add(playerMeshes[id]);
    }

    myGemCount = 0;
    myBoosts = maxBoosts;
    document.getElementById('boosts').innerText = `BOOSTS: ${myBoosts}/${maxBoosts}`;
    speed = 0;
    playAudio('start');

    const ws = document.getElementById('win-screen');
    if (ws) ws.style.display = 'none';
  });

  socket.on('player_update', (newPlayers) => {
    for (let id in newPlayers) {
      if (players[id]) {
        players[id].isBot = newPlayers[id].isBot;
        players[id].name = newPlayers[id].name;
      }
    }
    renderPlayerList();
  });

  socket.on('game_over', (data) => {
    const ws = document.getElementById('win-screen');
    if (ws) ws.style.display = 'block';
    document.getElementById('win-text').innerText = `${data.winner} TEAM WINS!`;
    document.getElementById('win-text').style.color = data.winner === 'RED' ? '#ff3333' : '#33aaff';
    document.getElementById('countdown-number').innerText = '10';
    const cd = document.getElementById('countdown-number');
    cd.classList.remove('countdown-anim');
    void cd.offsetWidth;
    cd.classList.add('countdown-anim');
    playAudio('start');
  });

  socket.on('countdown', (num) => {
    const cd = document.getElementById('countdown-number');
    cd.innerText = num.toString();
    cd.classList.remove('countdown-anim');
    void cd.offsetWidth;
    cd.classList.add('countdown-anim');
    playAudio('collect');
  });

  document.getElementById('restart-btn').addEventListener('click', () => {
    socket.emit('restart_game');
  });

  setInterval(() => {
    if (myBoosts < maxBoosts) {
      myBoosts++;
      document.getElementById('boosts').innerText = `BOOSTS: ${myBoosts}/${maxBoosts}`;
    }
  }, 10000);

  document.getElementById('spawn-red-ai').addEventListener('click', () => socket.emit('spawn_ai', 'red'));
  document.getElementById('spawn-blue-ai').addEventListener('click', () => socket.emit('spawn_ai', 'blue'));
  document.getElementById('restart-server-btn').addEventListener('click', () => socket.emit('restart_server'));
}

// INPUT HANDLING
window.addEventListener('keydown', (e) => {
  if (!gameJoined) return;
  const k = e.key.toLowerCase();
  if (keys.hasOwnProperty(k)) keys[k] = true;
  if (k === ' ') keys.space = true;
  if (e.key === 'ArrowUp') keys.w = true;
  if (e.key === 'ArrowDown') keys.s = true;
  if (e.key === 'ArrowLeft') keys.a = true;
  if (e.key === 'ArrowRight') keys.d = true;
});

window.addEventListener('keyup', (e) => {
  if (!gameJoined) return;
  const k = e.key.toLowerCase();
  if (keys.hasOwnProperty(k)) keys[k] = false;
  if (k === ' ') keys.space = false;
  if (e.key === 'ArrowUp') keys.w = false;
  if (e.key === 'ArrowDown') keys.s = false;
  if (e.key === 'ArrowLeft') keys.a = false;
  if (e.key === 'ArrowRight') keys.d = false;
});

// Welcome Screen Logic
let gameJoined = false;
const welcomeScreen = document.getElementById('welcome-screen');
const playBtn = document.getElementById('play-btn');
const nameInput = document.getElementById('player-name-input');

const DRIVER_NAMES = ["Grave Digger", "Mud Slinger", "Nitro Crusher", "Bone Shaker", "Max-D", "El Toro Loco", "Monster Mutt", "Zombie", "Megadon", "Earth Shaker", "Swamp Thing", "Crushstation", "Avenger", "Bounty Hunter", "Iron Outlaw", "Dragon", "Son-uva Digger", "Lucas Oil Crusader", "Stone Crusher", "Overkill Evolution"];

if (nameInput) {
    nameInput.value = DRIVER_NAMES[Math.floor(Math.random() * DRIVER_NAMES.length)];
    nameInput.addEventListener('focus', () => {
        nameInput.value = '';
    }, { once: true });
}

if (playBtn) {
    playBtn.addEventListener('click', () => {
        if (welcomeScreen) welcomeScreen.style.display = 'none';
        const finalName = nameInput.value.trim() || "Driver " + Math.floor(Math.random() * 1000);
        socket.emit('set_name', finalName);
        gameJoined = true;
        
        // Start engine audio here too to ensure user interaction unlocks audio context
        if (audioCtx.state === 'suspended') audioCtx.resume();
    });
}

// Help Modal
const helpBtn = document.getElementById('help-btn');
const closeHelpBtn = document.getElementById('close-help-btn');
const instructionsModal = document.getElementById('instructions-modal');

if (helpBtn) {
  helpBtn.addEventListener('click', () => {
    if(instructionsModal) instructionsModal.style.display = 'block';
    helpBtn.style.display = 'none';
  });
}
if (closeHelpBtn) {
  closeHelpBtn.addEventListener('click', () => {
    if(instructionsModal) instructionsModal.style.display = 'none';
    if(helpBtn) helpBtn.style.display = 'block';
  });
}

// Settings Modal
const settingsBtn = document.getElementById('settings-btn');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const settingsModal = document.getElementById('settings-modal');

if (settingsBtn) {
  settingsBtn.addEventListener('click', () => {
    if(settingsModal) settingsModal.style.display = 'flex';
    settingsBtn.style.display = 'none';
  });
}
if (closeSettingsBtn) {
  closeSettingsBtn.addEventListener('click', () => {
    if(settingsModal) settingsModal.style.display = 'none';
    if(settingsBtn) settingsBtn.style.display = 'block';
  });
}

const volumeSlider = document.getElementById('volume-slider');
const muteBtn = document.getElementById('mute-btn');
let isMuted = false;
let previousVolume = 0.5;

if (volumeSlider) {
  volumeSlider.addEventListener('input', (e) => {
    const vol = parseFloat(e.target.value);
    if (!isMuted) {
      masterGain.gain.value = vol;
    }
    previousVolume = vol;
    if (vol === 0) {
      isMuted = true;
      if (muteBtn) muteBtn.innerText = '🔇';
    } else {
      isMuted = false;
      if (muteBtn) muteBtn.innerText = '🔊';
    }
  });
}

if (muteBtn) {
  muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    if (isMuted) {
      masterGain.gain.value = 0;
      muteBtn.innerText = '🔇';
      volumeSlider.value = 0;
    } else {
      masterGain.gain.value = previousVolume > 0 ? previousVolume : 0.5;
      muteBtn.innerText = '🔊';
      volumeSlider.value = masterGain.gain.value;
    }
  });
}

// Touch Controls
const touchMap = {
  'btn-fwd': ['w'],
  'btn-back': ['s'],
  'btn-fwd-left': ['w', 'a'],
  'btn-fwd-right': ['w', 'd'],
  'btn-boost': ['space']
};

for (const [id, keyArr] of Object.entries(touchMap)) {
  const btn = document.getElementById(id);
  if (btn) {
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (!gameJoined) return;
      keyArr.forEach(k => keys[k] = true);
      btn.classList.add('active');
    }, {passive: false});
    
    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (!gameJoined) return;
      keyArr.forEach(k => keys[k] = false);
      btn.classList.remove('active');
    }, {passive: false});
    
    btn.addEventListener('touchcancel', (e) => {
      e.preventDefault();
      if (!gameJoined) return;
      keyArr.forEach(k => keys[k] = false);
      btn.classList.remove('active');
    }, {passive: false});
  }
}

// INITIALIZE
buildEnvironment();
setupNetworking();

// GAME LOOP VARIABLES
let speed = 0;
let yVelocity = 0;
let defaultMaxSpeed = 40;
let maxSpeed = defaultMaxSpeed;
let acceleration = 60;
const defaultFriction = 20;
let friction = defaultFriction;
const turnSpeed = 2.5;
const gravity = 80;

let lastTime = performance.now();
let boostActive = 0;
const particles = [];

function createBoostParticles(x, y, z, rot) {
  if (Math.random() > 0.6) return; // control spawn rate
  const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 1 });
  const p = new THREE.Mesh(geo, mat);
  const backX = x - Math.sin(rot) * 3 + (Math.random() - 0.5);
  const backZ = z - Math.cos(rot) * 3 + (Math.random() - 0.5);
  p.position.set(backX, y + 0.5 + Math.random(), backZ);
  p.userData = {
    vx: -Math.sin(rot) * (15 + Math.random() * 10) + (Math.random() - 0.5) * 5,
    vy: 2 + Math.random() * 3,
    vz: -Math.cos(rot) * (15 + Math.random() * 10) + (Math.random() - 0.5) * 5,
    life: 1.0
  };
  scene.add(p);
  particles.push(p);
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.userData.life -= dt * 2.5;
    if (p.userData.life <= 0) {
      scene.remove(p);
      particles.splice(i, 1);
    } else {
      p.position.x += p.userData.vx * dt;
      p.position.y += p.userData.vy * dt;
      p.position.z += p.userData.vz * dt;
      p.userData.vy -= 20 * dt; // gravity
      p.scale.setScalar(p.userData.life);
      p.material.opacity = p.userData.life;
    }
  }
}

function checkCollisions(me, dt) {
  maxSpeed = defaultMaxSpeed;
  friction = defaultFriction;
  let hittingWall = false;

  // Obstacle checks 
  for (let obs of obstacles) {
    const hw = obs.w / 2;
    const hd = obs.d / 2;
    const inX = me.x > obs.x - hw && me.x < obs.x + hw;
    const inZ = me.z > obs.z - hd && me.z < obs.z + hd;

    if (inX && inZ) {
      if (obs.type === 'mud' && me.y <= 0.1) {
        maxSpeed = 15;
        friction = 60;
      } else if (obs.type === 'boost' && me.y <= 0.1) {
        maxSpeed = 80;
        speed += 100 * dt;
      } else if (obs.type === 'jump' && me.y <= 0.5) {
        if (speed > 20 && yVelocity <= 0) {
          yVelocity = 35;
          playAudio('jump');
        }
      } else if (obs.type === 'wall' && me.y < 3) {
        hittingWall = true;
      }
    }
  }

  if (hittingWall) {
    speed = -speed * 0.5;
    me.x -= Math.sin(me.rotation) * 2;
    me.z -= Math.cos(me.rotation) * 2;
  }

  // Bumping other players
  if (Math.abs(speed) > 30) {
    for (let id in players) {
      if (id === myId) continue;
      const p = players[id];
      const dx = me.x - p.x;
      const dz = me.z - p.z;
      if (dx * dx + dz * dz < 16 && p.y < 3) {
        socket.emit('bump_player', id);
        speed *= -0.5;
        me.x -= Math.sin(me.rotation) * 2;
        me.z -= Math.cos(me.rotation) * 2;
        playAudio('bump');
      }
    }
  }

  // Gem checks
  if (myGemCount < 5) {
    for (let i = 0; i < gems.length; i++) {
      const g = gems[i];
      if (g.vy !== undefined) continue; // Not pickable while falling
      const distSq = (me.x - g.x) ** 2 + (me.z - g.z) ** 2;
      if (distSq < 16 && me.y < 4) {
        socket.emit('collect_gem', g.id);
        break; // Let server validate it
      }
    }
  }

  // Lightning checks
  for (let i = 0; i < lightnings.length; i++) {
    const L = lightnings[i];
    const distSq = (me.x - L.x) ** 2 + (me.z - L.z) ** 2;
    if (distSq < 25 && me.y < 4) {
      socket.emit('trigger_lightning', L.id);
      lightnings.splice(i, 1);
      break;
    }
  }

  // Base checks (Scoring & Recharge)
  const isRedBase = myTeam === 'red' && me.x < -60 && Math.abs(me.z) < 20;
  const isBlueBase = myTeam === 'blue' && me.x > 60 && Math.abs(me.z) < 20;

  if ((isRedBase || isBlueBase) && me.y < 2) {
    if (myGemCount > 0) socket.emit('score');
    if (myBoosts < maxBoosts) {
      myBoosts = maxBoosts;
      document.getElementById('boosts').innerText = `BOOSTS: ${myBoosts}/${maxBoosts}`;
      playAudio('collect');
    }
  }
}

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  // Spin gems & Animate dropped gems
  for (let i = 0; i < gems.length; i++) {
    const g = gems[i];
    if (gemMeshes[g.id]) {
      gemMeshes[g.id].rotation.y += 2 * dt;
      if (g.vy !== undefined) {
        g.x += g.vx * dt;
        g.z += g.vz * dt;
        g.y = (g.y || 1.5) + g.vy * dt;
        g.vy -= gravity * dt;
        if (g.y <= 1.5) {
          g.y = 1.5;
          delete g.vy; delete g.vx; delete g.vz;
        }
        gemMeshes[g.id].position.set(g.x, g.y, g.z);
      }
    }
  }

  redScoreGems.forEach(g => g.rotation.y += 2 * dt);
  blueScoreGems.forEach(g => g.rotation.y += 2 * dt);

  for (let i = 0; i < lightnings.length; i++) {
    const L = lightnings[i];
    if (lightningMeshes[L.id]) {
      lightningMeshes[L.id].rotation.y += 3 * dt;
    }
  }

  updateParticles(dt);

  // Sparkle particles for max gems
  for (let id in players) {
    const p = players[id];
    if (p.gemCount >= 5 && playerMeshes[id]) {
        if (Math.random() > 0.8) {
            const geo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
            const mat = new THREE.MeshBasicMaterial({ color: 0xffdd00, transparent: true, opacity: 1 });
            const part = new THREE.Mesh(geo, mat);
            part.position.set(p.x + (Math.random()-0.5)*4, (p.y||0) + 4 + Math.random()*2, p.z + (Math.random()-0.5)*4);
            part.userData = {
                vx: (Math.random()-0.5)*5, vy: 5 + Math.random()*5, vz: (Math.random()-0.5)*5, life: 1.0
            };
            scene.add(part);
            particles.push(part);
        }
    }
  }

  if (myId && players[myId]) {
    const me = players[myId];

    if (keys.w) speed += acceleration * dt;
    else if (keys.s) speed -= acceleration * dt;
    else {
      if (speed > 0) speed = Math.max(0, speed - friction * dt);
      if (speed < 0) speed = Math.min(0, speed + friction * dt);
    }

    if (keys.space && !lastSpacePress) {
      if (myBoosts > 0) {
        myBoosts--;
        document.getElementById('boosts').innerText = `BOOSTS: ${myBoosts}/${maxBoosts}`;
        speed = 100;
        boostActive = 0.5;
        playAudio('jump');
      }
    }
    lastSpacePress = keys.space;

    if (boostActive > 0) {
      boostActive -= dt;
      maxSpeed = 100;
      createBoostParticles(me.x, me.y, me.z, me.rotation);
    } else {
      maxSpeed = defaultMaxSpeed;
    }

    if (speed > maxSpeed) {
      speed -= friction * 2 * dt; // Slow down naturally
    } else {
      speed = Math.max(-maxSpeed / 2, Math.min(speed, maxSpeed));
    }

    if (!me.isBot) {
      me.y += yVelocity * dt;
      if (me.y > 0) yVelocity -= gravity * dt;
      else {
        me.y = 0; yVelocity = 0;
        if (Math.abs(speed) > 1) {
          const turnDir = speed > 0 ? 1 : -1;
          if (keys.a) me.rotation += turnSpeed * dt * turnDir;
          if (keys.d) me.rotation -= turnSpeed * dt * turnDir;
        }
      }

      me.x += Math.sin(me.rotation) * speed * dt;
      me.z += Math.cos(me.rotation) * speed * dt;
      me.x = THREE.MathUtils.clamp(me.x, -MAP_WIDTH / 2, MAP_WIDTH / 2);
      me.z = THREE.MathUtils.clamp(me.z, -MAP_HEIGHT / 2, MAP_HEIGHT / 2);

      checkCollisions(me, dt);

      if (playerMeshes[myId]) {
        playerMeshes[myId].position.set(me.x, me.y, me.z);
        playerMeshes[myId].rotation.y = me.rotation;
        playerMeshes[myId].rotation.x = speed * 0.002;
      }

      if (Math.abs(speed) > 0.1 || keys.a || keys.d || yVelocity !== 0 || boostActive > 0) {
        socket.emit('move', { x: me.x, y: me.y, z: me.z, rotation: me.rotation, gemCount: myGemCount });
      }
    } else {
      // Autopilot bypasses physics so client respects server player_moved override
      // Update local mesh roll based on speed
      if (playerMeshes[myId]) {
        playerMeshes[myId].rotation.x = speed * 0.002;
      }
    }

    const targetCamX = me.x - 30;
    const targetCamY = 50;
    const targetCamZ = me.z + 30;

    camera.position.x += (targetCamX - camera.position.x) * 5 * dt;
    camera.position.y = targetCamY;
    camera.position.z += (targetCamZ - camera.position.z) * 5 * dt;
    camera.lookAt(camera.position.x + 30, 0, camera.position.z - 30);

    if (engineOsc) {
      engineOsc.frequency.value = 50 + Math.abs(speed) * 1.5;
    }
  }

  renderer.render(scene, camera);
}

animate();
