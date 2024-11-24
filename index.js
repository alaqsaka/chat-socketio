const express = require('express');
const { createServer } = require('node:http');
const { join } = require('node:path');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function main() {
    const db = await open({
        filename: 'chat.db',
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_offset TEXT UNIQUE, 
            content TEXT
        );
    `);

    const app = express();
    const server = createServer(app);
    const io = new Server(server, {
        connectionStateRecovery: {}
    });

    // Middleware untuk file statis
    app.use(express.static(join(__dirname, 'public')));

    app.get('/', (req, res) => {
        res.sendFile(join(__dirname, 'index.html'));
    });

    const users = new Set();

    io.on('connection', async (socket) => {
        socket.broadcast.emit('chat message', `${socket.id} has joined the chat`);
        users.add(socket.id);
        io.emit('users', Array.from(users));

        socket.on('chat message', async (msg, clientOffset, callback) => {
            let result;
            const timestamp = new Date().toISOString();
            try {
                result = await db.run(
                    'INSERT INTO messages (content, client_offset) VALUES (?, ?)',
                    msg, clientOffset
                );
            } catch (error) {
                if (error.errno === 19) {
                    callback();
                } else {
                    console.error('Error storing message to DB');
                }
                return;
            }
            
            io.emit('chat message', msg, result.lastID, timestamp);
            callback();
        });

        if (!socket.recovered) {
            try {
                await db.each(
                    'SELECT id, content FROM messages WHERE id > ?', 
                    [socket.handshake.auth.serverOffset || 0],
                    (_err, row) => {
                        socket.emit('chat message', row.content, row.id);
                    }
                );
            } catch (e) {
                console.error('Something went wrong on db.each content');
            }
        }

        socket.on('disconnect', () => {
            console.log(`User with ID ${socket.id} disconnected`);
            socket.broadcast.emit('chat message', `${socket.id} has joined the chat`);
            users.delete(socket.id);
            io.emit('users', Array.from(users));
        });
    });

    server.listen(3000, () => {
        console.log('Server running at http://localhost:3000');
    });
}

main();
