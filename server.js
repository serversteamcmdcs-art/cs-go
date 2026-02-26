/**
 * CS:GO 10000000.16 - Серверная часть
 * Node.js + Express + Socket.io
 * 
 * Этот файл отвечает за:
 * - Раздачу статических файлов (HTML, CSS, JS)
 * - Обработку WebSocket подключений
 * - Синхронизацию игроков между собой
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Порт сервера
const PORT = process.env.PORT || 3000;

// Хранилище подключенных игроков
// Ключ - ID сокета, значение - объект игрока
const players = {};

// Статистика убийств
const stats = {}; // { socketId: { name, kills, deaths } }

// Раздача статических файлов из папки public
app.use(express.static(path.join(__dirname, 'public')));

// Маршрут для главной страницы
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Обработка WebSocket подключений
io.on('connection', (socket) => {
    console.log(`Новый игрок подключился: ${socket.id}`);

    // Создаем нового игрока с дефолтными координатами
    players[socket.id] = {
        id: socket.id,
        x: 0,
        y: 1,
        z: 0,
        rotationY: 0,
        team: null,
        name: `Игрок_${socket.id.slice(0, 4)}`
    };

    stats[socket.id] = {
        id: socket.id,
        name: players[socket.id].name,
        kills: 0,
        deaths: 0
    };

    // Отправляем текущему игроку список всех игроков
    socket.emit('currentPlayers', players);

    // Отправляем текущую статистику новому игроку
    socket.emit('leaderboard', Object.values(stats));

    // Уведомляем всех остальных о новом игроке
    socket.broadcast.emit('newPlayer', players[socket.id]);

    // Обработка получения координат от игрока
    socket.on('playerMovement', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].z = data.z;
            players[socket.id].rotationY = data.rotationY;

            // Рассылаем обновленные координаты всем остальным
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });

    // Обработка выбора команды
    socket.on('selectTeam', (team) => {
        if (players[socket.id] && (team === 'CT' || team === 'T')) {
            players[socket.id].team = team;
            // Уведомляем всех о смене команды
            io.emit('playerTeamChanged', players[socket.id]);
        }
    });

    // Обработка выстрела - рассылаем пули другим игрокам
    socket.on('shoot', (data) => {
        socket.broadcast.emit('bulletFired', {
            id: socket.id,
            position: data.position,
            direction: data.direction
        });
    });

    // Обработка попадания
    socket.on('playerHit', (data) => {
        // Пересылаем урон конкретному игроку
        io.to(data.targetId).emit('playerWasHit', {
            targetId: data.targetId,
            damage: data.damage
        });
    });

    // Обработка убийства
    socket.on('playerKilled', (data) => {
        const killerId = socket.id;
        const victimId = data.victimId;

        if (stats[killerId]) stats[killerId].kills++;
        if (stats[victimId]) stats[victimId].deaths++;

        // Рассылаем обновлённый лидерборд всем
        const leaderboard = Object.values(stats)
            .sort((a, b) => b.kills - a.kills);
        io.emit('leaderboard', leaderboard);

        // Уведомление об убийстве
        io.emit('killFeed', {
            killerName: stats[killerId] ? stats[killerId].name : '?',
            victimName: stats[victimId]  ? stats[victimId].name  : '?'
        });
    });

    // Обработка отключения игрока
    socket.on('disconnect', () => {
        console.log(`Игрок отключился: ${socket.id}`);
        
        delete players[socket.id];
        delete stats[socket.id];

        io.emit('playerDisconnected', socket.id);

        // Обновляем лидерборд
        const leaderboard = Object.values(stats).sort((a, b) => b.kills - a.kills);
        io.emit('leaderboard', leaderboard);
    });
});

// Запуск сервера
server.listen(PORT, () => {
    console.log(`========================================`);
    console.log(`  CS:GO 10000000.16 - Сервер запущен`);
    console.log(`  Адрес: http://localhost:${PORT}`);
    console.log(`========================================`);
});
