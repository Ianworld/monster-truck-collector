import * as THREE from 'three';
import { io } from 'socket.io-client';

// SETUP THREE.JS
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // Sky color

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
let hasGem = false;
let players = {};
let playerMeshes = {};
let gems = [];
let gemMeshes = {};
let obstacles = [];
let obstacleMeshes = [];
let scores = { red: 0, blue: 0 };

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

  const gridHelper = new THREE.GridHelper(200, 20);
  scene.add(gridHelper);
}

function buildObstacles(obsts) {
  obsts.forEach(obs => {
    let geo, mat, yPos;
    if (obs.type === 'jump') {
      // Ramp shape (using a box angled up)
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
        // Angled ramp
        mesh.position.y = 1;
        mesh.rotation.x = obs.x < 0 ? Math.PI/8 : -Math.PI/8; // point towards middle roughly
        if (obs.x < 0) mesh.rotation.z = -Math.PI/8;
      }
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      scene.add(mesh);
      obstacleMeshes.push(mesh);
    }
  });
}

function spawnGemMesh(gem) {
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

// CREATE TRUCK MESH
function createTruckMesh(colorName, showGem = false) {
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

  // Gem indicator
  if (showGem) {
    const gemGeo = new THREE.OctahedronGeometry(1);
    const gemMat = new THREE.MeshLambertMaterial({ color: 0xffd700 });
    const gemMesh = new THREE.Mesh(gemGeo, gemMat);
    gemMesh.position.set(0, 6, -1);
    group.add(gemMesh);
  }

  const wheelGeo = new THREE.CylinderGeometry(1.5, 1.5, 1, 16);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  
  const wPositions = [
    [-2.5, 1.5, -3],
    [2.5, 1.5, -3],
    [-2.5, 1.5, 3],
    [2.5, 1.5, 3]
  ];

  wPositions.forEach(pos => {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(pos[0], pos[1], pos[2]);
    w.castShadow = true;
    group.add(w);
  });

  return group;
}

function updateScores(newScores) {
  scores = newScores;
  document.getElementById('red-score').innerText = `Red Team: ${scores.red}`;
  document.getElementById('blue-score').innerText = `Blue Team: ${scores.blue}`;
}

// SOCKET & MULTIPLAYER SETUP
function setupNetworking() {
  socket = io('http://localhost:3000'); // Or window.location.origin

  socket.on('init', (data) => {
    myId = data.id;
    players = data.players;
    myTeam = players[myId].team;
    gems = data.gems;
    obstacles = data.obstacles || [];
    
    if (data.scores) updateScores(data.scores);

    buildObstacles(obstacles);
    gems.forEach(g => spawnGemMesh(g));

    for (let id in players) {
      const p = players[id];
      const mesh = createTruckMesh(p.team, p.hasGem);
      mesh.position.set(p.x, p.y, p.z);
      mesh.rotation.y = p.rotation;
      scene.add(mesh);
      playerMeshes[id] = mesh;
    }
  });

  socket.on('player_join', (data) => {
    players[data.id] = data.player;
    const mesh = createTruckMesh(data.player.team, data.player.hasGem);
    mesh.position.set(data.player.x, data.player.y, data.player.z);
    mesh.rotation.y = data.player.rotation;
    scene.add(mesh);
    playerMeshes[data.id] = mesh;
  });

  socket.on('player_moved', (data) => {
    if (players[data.id]) {
      // If gem state changed, recreate mesh
      if (players[data.id].hasGem !== data.hasGem) {
         scene.remove(playerMeshes[data.id]);
         playerMeshes[data.id] = createTruckMesh(players[data.id].team, data.hasGem);
         scene.add(playerMeshes[data.id]);
      }

      players[data.id].x = data.x;
      players[data.id].y = data.y;
      players[data.id].z = data.z;
      players[data.id].rotation = data.rotation;
      players[data.id].hasGem = data.hasGem;
      
      if (playerMeshes[data.id]) {
        playerMeshes[data.id].position.set(data.x, data.y, data.z);
        playerMeshes[data.id].rotation.y = data.rotation;
      }
    }
  });

  socket.on('gem_collected', (gemId) => {
    gems = gems.filter(g => g.id !== gemId);
    removeGemMesh(gemId);
  });

  socket.on('gem_spawned', (gem) => {
    gems.push(gem);
    spawnGemMesh(gem);
  });

  socket.on('score_update', (newScores) => {
    updateScores(newScores);
  });

  socket.on('player_leave', (id) => {
    if (playerMeshes[id]) {
      scene.remove(playerMeshes[id]);
      delete playerMeshes[id];
    }
    delete players[id];
  });
}

// INPUT HANDLING
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (keys.hasOwnProperty(k)) keys[k] = true;
  if (k === ' ') keys.space = true;
  if(e.key === 'ArrowUp') keys.w = true;
  if(e.key === 'ArrowDown') keys.s = true;
  if(e.key === 'ArrowLeft') keys.a = true;
  if(e.key === 'ArrowRight') keys.d = true;
});

window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (keys.hasOwnProperty(k)) keys[k] = false;
  if (k === ' ') keys.space = false;
  if(e.key === 'ArrowUp') keys.w = false;
  if(e.key === 'ArrowDown') keys.s = false;
  if(e.key === 'ArrowLeft') keys.a = false;
  if(e.key === 'ArrowRight') keys.d = false;
});

window.addEventListener('resize', () => {
    const aspect = window.innerWidth / window.innerHeight;
    camera.left = -viewSize * aspect / 2;
    camera.right = viewSize * aspect / 2;
    camera.top = viewSize / 2;
    camera.bottom = -viewSize / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

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

function checkCollisions(me, dt) {
  // Reset modifiers
  maxSpeed = defaultMaxSpeed;
  friction = defaultFriction;
  
  let hittingWall = false;

  // Obstacle checks (simple 2D AABB)
  for (let obs of obstacles) {
    const hw = obs.w / 2;
    const hd = obs.d / 2;
    const inX = me.x > obs.x - hw && me.x < obs.x + hw;
    const inZ = me.z > obs.z - hd && me.z < obs.z + hd;

    if (inX && inZ) {
      if (obs.type === 'mud' && me.y <= 0.1) {
        maxSpeed = 15;
        friction = 60; // slow down faster
      } else if (obs.type === 'boost' && me.y <= 0.1) {
        maxSpeed = 80;
        speed += 100 * dt; // quick boost
      } else if (obs.type === 'jump' && me.y <= 0.5) {
        if (speed > 20) {
          yVelocity = 35; // bounce up
        }
      } else if (obs.type === 'wall' && me.y < 3) {
        hittingWall = true;
      }
    }
  }

  // Wall collision response
  if (hittingWall) {
     speed = -speed * 0.5; // bounce back
     // push out slightly
     me.x -= Math.sin(me.rotation) * 2;
     me.z -= Math.cos(me.rotation) * 2;
  }

  // Gem checks
  if (!hasGem) {
    for (let i = 0; i < gems.length; i++) {
        const g = gems[i];
        const distSq = (me.x - g.x)**2 + (me.z - g.z)**2;
        if (distSq < 16 && me.y < 4) { // within 4 units distance
           hasGem = true;
           me.hasGem = true;
           // Recreate mesh to show gem
           scene.remove(playerMeshes[myId]);
           playerMeshes[myId] = createTruckMesh(me.team, true);
           scene.add(playerMeshes[myId]);
           
           socket.emit('collect_gem', g.id);
           break;
        }
    }
  }

  // Base checks (Scoring)
  if (hasGem) {
    const isRedBase = myTeam === 'red' && me.x < -60 && Math.abs(me.z) < 20;
    const isBlueBase = myTeam === 'blue' && me.x > 60 && Math.abs(me.z) < 20;
    
    if ((isRedBase || isBlueBase) && me.y < 2) {
      hasGem = false;
      me.hasGem = false;
      scene.remove(playerMeshes[myId]);
      playerMeshes[myId] = createTruckMesh(me.team, false);
      scene.add(playerMeshes[myId]);

      socket.emit('score');
    }
  }
}

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  // Spin gems
  for (let id in gemMeshes) {
      gemMeshes[id].rotation.y += 2 * dt;
  }

  if (myId && players[myId]) {
    const me = players[myId];
    me.hasGem = hasGem;
    
    // Physics Logic
    if (keys.w) {
      speed += acceleration * dt;
    } else if (keys.s) {
      speed -= acceleration * dt;
    } else {
      if (speed > 0) speed = Math.max(0, speed - friction * dt);
      if (speed < 0) speed = Math.min(0, speed + friction * dt);
    }
    
    if (keys.space) {
        if (speed > 0) speed = Math.max(0, speed - 100 * dt);
        if (speed < 0) speed = Math.min(0, speed + 100 * dt);
    }

    speed = THREE.MathUtils.clamp(speed, -maxSpeed/2, maxSpeed);

    // Gravity & Y velocity
    me.y += yVelocity * dt;
    if (me.y > 0) {
      yVelocity -= gravity * dt;
    } else {
      me.y = 0;
      yVelocity = 0;
      
      // Steering only works if on ground and moving
      if (Math.abs(speed) > 1) {
        const turnDir = speed > 0 ? 1 : -1;
        if (keys.a) me.rotation += turnSpeed * dt * turnDir;
        if (keys.d) me.rotation -= turnSpeed * dt * turnDir;
      }
    }

    // Apply Velocity
    me.x += Math.sin(me.rotation) * speed * dt;
    me.z += Math.cos(me.rotation) * speed * dt;

    // Boundaries
    me.x = THREE.MathUtils.clamp(me.x, -MAP_WIDTH/2, MAP_WIDTH/2);
    me.z = THREE.MathUtils.clamp(me.z, -MAP_HEIGHT/2, MAP_HEIGHT/2);

    checkCollisions(me, dt);

    // Update Mesh
    if (playerMeshes[myId]) {
      playerMeshes[myId].position.set(me.x, me.y, me.z);
      playerMeshes[myId].rotation.y = me.rotation;
      // Slight tilt when moving fast
      playerMeshes[myId].rotation.x = speed * 0.002;
    }

    const targetCamX = me.x - 30;
    const targetCamY = 50;
    const targetCamZ = me.z + 30;
    
    camera.position.x += (targetCamX - camera.position.x) * 5 * dt;
    camera.position.y = targetCamY;
    camera.position.z += (targetCamZ - camera.position.z) * 5 * dt;
    camera.lookAt(camera.position.x + 30, 0, camera.position.z - 30);

    // Send update to server
    if (Math.abs(speed) > 0.1 || keys.a || keys.d || yVelocity !== 0) {
        socket.emit('move', {
            x: me.x,
            y: me.y,
            z: me.z,
            rotation: me.rotation,
            hasGem: hasGem
        });
    }
  }

  renderer.render(scene, camera);
}

// Start loop
animate();
