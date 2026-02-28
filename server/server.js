/**
 * CS:GO 10000000.16 - Multiplayer Server
 * Node.js + Socket.io сервер для синхронизации игроков
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

// Хранилище подключённых игроков
// Ключ - ID сокета, значение - объект игрока
const players = {};

// Обслуживание статических файлов из папки ../export (Godot export)
// Предполагается, что игра экспортируется в папку "export"
const staticPath = path.join(__dirname, '..', 'export');
app.use(express.static(staticPath));

// Индексный файл
app.get('/', (req, res) => {
    res.sendFile(path.join(staticPath, 'index.html'));
});

// Обработчик подключения игрока
io.on('connection', (socket) => {
    console.log(`[INFO] Новый игрок подключился: ${socket.id}`);

    // Создаём нового игрока с начальными координатами
    players[socket.id] = {
        id: socket.id,
        x: 0,
        y: 2,  // Немного над полом
        z: 0,
        rotation_x: 0,
        rotation_y: 0,
        color: generateRandomColor()
    };

    // Отправляем текущему игроку его ID и список всех игроков
    socket.emit('init', {
        myId: socket.id,
        players: players
    });

    // Уведомляем всех остальных о новом игроке
    socket.broadcast.emit('player_joined', players[socket.id]);

    // Обработчик получения позиции игрока
    socket.on('update_position', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].z = data.z;
            players[socket.id].rotation_x = data.rotation_x;
            players[socket.id].rotation_y = data.rotation_y;

            // Рассылаем обновлённые координаты всем остальным игрокам
            socket.broadcast.emit('player_moved', players[socket.id]);
        }
    });

    // Обработчик отключения игрока
    socket.on('disconnect', () => {
        console.log(`[INFO] Игрок отключился: ${socket.id}`);
        
        // Удаляем игрока из хранилища
        delete players[socket.id];

        // Уведомляем всех об отключении игрока
        io.emit('player_left', socket.id);
    });

    // Обработка чат-сообщений (опционально)
    socket.on('chat_message', (message) => {
        io.emit('chat_message', {
            playerId: socket.id,
            message: message
        });
    });
});

// Генерация случайного цвета для игрока
function generateRandomColor() {
    const colors = [
        '#FF5733', '#33FF57', '#3357FF', '#FF33F5', 
        '#33FFF5', '#F5FF33', '#FF8C33', '#8C33FF'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

// Запуск сервера
server.listen(PORT, () => {
    console.log(`[SERVER] CS:GO 10000000.16 сервер запущен на порту ${PORT}`);
    console.log(`[SERVER] Откройте http://localhost:${PORT} в браузере`);
});
