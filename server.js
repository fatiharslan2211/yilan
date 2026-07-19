require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Supabase Setup
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(express.static(path.join(__dirname, '.')));

// Oyun Sabitleri
const WORLD_SIZE = 3400;
const FOOD_COUNT = 300;

// Oyun Durumu
let players = {};
let foods = [];

// Başlangıçta yemekleri oluştur
for (let i = 0; i < FOOD_COUNT; i++) {
    spawnFood();
}

function spawnFood() {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * (WORLD_SIZE - 40);
    foods.push({
        id: Math.random().toString(36).substr(2, 9),
        x: Math.cos(a) * d,
        y: Math.sin(a) * d,
        r: 3 + Math.random() * 2,
        val: 1,
        color: `hsl(${Math.floor(Math.random() * 360)}, 90%, 62%)`,
        phase: Math.random() * 6
    });
}

io.on('connection', (socket) => {
    console.log('Yeni oyuncu bağlandı:', socket.id);

    socket.on('join', (data) => {
        players[socket.id] = {
            id: socket.id,
            name: data.name || 'Misafir',
            skin: data.skin || 0,
            x: (Math.random() - 0.5) * 2000,
            y: (Math.random() - 0.5) * 2000,
            angle: Math.random() * Math.PI * 2,
            length: 10,
            segs: [], // Sunucu tarafında takip edilecek segmentler
            alive: true,
            score: 0
        };
        
        // Yeni oyuncuya mevcut durumu gönder
        socket.emit('init', {
            id: socket.id,
            players: players,
            foods: foods,
            worldSize: WORLD_SIZE
        });

        // Diğerlerine yeni oyuncuyu bildir
        socket.broadcast.emit('newPlayer', players[socket.id]);
    });

    socket.on('update', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].angle = data.angle;
            players[socket.id].segs = data.segs;
            players[socket.id].length = data.length;
            players[socket.id].boosting = data.boosting;
        }
    });

    socket.on('eatFood', (foodId) => {
        const foodIdx = foods.findIndex(f => f.id === foodId);
        if (foodIdx !== -1) {
            const food = foods[foodIdx];
            if (players[socket.id]) {
                players[socket.id].length += food.val;
                players[socket.id].score += food.val;
            }
            foods.splice(foodIdx, 1);
            spawnFood();
            io.emit('foodEaten', { foodId: foodId, newFood: foods[foods.length - 1], playerId: socket.id });
        }
    });

    socket.on('die', async (data) => {
        if (players[socket.id]) {
            console.log(`${players[socket.id].name} öldü. Skor: ${players[socket.id].score}`);
            
            // Skoru Supabase'e kaydet (Opsiyonel)
            if (players[socket.id].score > 10) {
                try {
                    await supabase.from('leaderboard').insert([
                        { name: players[socket.id].name, score: Math.floor(players[socket.id].score) }
                    ]);
                } catch (e) {
                    console.error('Skor kaydedilemedi:', e);
                }
            }

            delete players[socket.id];
            io.emit('playerDied', socket.id);
        }
    });

    socket.on('disconnect', () => {
        console.log('Oyuncu ayrıldı:', socket.id);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

// Broadcast state to all players every 50ms (20fps)
setInterval(() => {
    io.emit('stateUpdate', players);
}, 50);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor...`);
});
