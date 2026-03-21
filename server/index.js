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

const MAP_WIDTH = 200;
const MAP_HEIGHT = 100;

// simple random gem spawner
function spawnGem() {
  gems.push({
    id: Math.random().toString(36).substr(2, 9),
    x: (Math.random() - 0.5) * 40, // middle zone
    z: (Math.random() - 0.5) * 80
  });
}

// init 10 gems
for(let i=0; i<10; i++) spawnGem();

let teamAssignToggle = 0;

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);
  
  // Assign team (0 for red/left, 1 for blue/right)
  const team = teamAssignToggle % 2 === 0 ? 'red' : 'blue';
  teamAssignToggle++;

  players[socket.id] = {
    x: team === 'red' ? -80 : 80,
    y: 0,
    z: (Math.random() - 0.5) * 20,
    rotation: team === 'red' ? -Math.PI/2 : Math.PI/2,
    team: team,
    score: 0,
    hasGem: false
  };

  // Send current state to new player
  socket.emit('init', { id: socket.id, players, gems, obstacles, scores });
  
  // Tell everyone else about new player
  socket.broadcast.emit('player_join', { id: socket.id, player: players[socket.id] });

  socket.on('move', (data) => {
    if(players[socket.id]) {
      players[socket.id].x = data.x;
      players[socket.id].y = data.y;
      players[socket.id].z = data.z;
      players[socket.id].rotation = data.rotation;
      players[socket.id].hasGem = data.hasGem;
      
      // broadcast to everyone else
      socket.broadcast.emit('player_moved', { id: socket.id, ...players[socket.id] });
    }
  });

  socket.on('collect_gem', (gemId) => {
    const gemIndex = gems.findIndex(g => g.id === gemId);
    if (gemIndex !== -1) {
      gems.splice(gemIndex, 1);
      io.emit('gem_collected', gemId);
      // Spawn a new gem after a delay
      setTimeout(() => {
        spawnGem();
        io.emit('gem_spawned', gems[gems.length - 1]);
      }, 5000);
    }
  });

  socket.on('score', () => {
    if (players[socket.id]) {
      const team = players[socket.id].team;
      scores[team]++;
      io.emit('score_update', scores);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    delete players[socket.id];
    io.emit('player_leave', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
