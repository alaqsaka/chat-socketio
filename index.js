const express = require('express');
const { createServer } = require('node:http');
const { join } = require('node:path');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3');
const {open} = require('sqlite');

async function main() {
    // database file 
    const db = await open({
        filename: 'chat.db',
        driver: sqlite3.Database
    });

    // create messages table
    await db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_offset TEXT UNIQUE, 
            content TEXT
        );
    `)


    const app = express();
    const server = createServer(app);
    const io = new Server(server, {
    connectionStateRecovery: {}
    });

    app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'));
    });

    const users = new Set();

    io.on('connection', async (socket) => {
        users.add(socket.id);
        io.emit('users', Array.from(users));

        socket.on('chat message', async (msg, clientOffset, callback) => {
            let result;
            try {
                // store the message to database
                result = await db.run('INSERT INTO messages (content, client_offset) VALUES (?, ?)', msg, clientOffset);
            } catch (error) {
                if (error.errno === 19 ) { // SQLITE_CONSTRAINT
                    // the message was already inserted, notify client
                    callback();
                } else {
                    console.error('Error store message to DB');
                }
                return;
            }

            // include the offeset with the message
            io.emit('chat message', msg, result.lastID);
            callback();
        });

        if (!socket.recovered) {
            // if the connection state recovery was not success
            try {
                await db.each('SELECT id, content FROM messages WHERE id > ?', 
                    [socket.handshake.auth.serverOffset || 0],
                    (_err, row) => {
                        socket.emit('chat message', row.content, row.id);
                    }
                )
            } catch (e) {
                console.error('Something went wrong on db.each content');
            }
        }

        socket.on('disconnect', () => {
            console.log(`User with ID ${socket.id} disconnected`);
            users.delete(socket.id);
            io.emit('users', Array.from(users));
        });
    });

    server.listen(3000, () => {
    console.log('server running at http://localhost:3000');
    });

}

main();