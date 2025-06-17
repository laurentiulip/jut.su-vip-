const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store rooms and their clients
const rooms = new Map();

wss.on('connection', (ws) => {
    console.log('Client connected');
    let currentRoom = null;
    let clientId = Math.random().toString(36).substring(7);

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        switch(data.type) {
            case 'create_room':
                const roomId = data.roomId;
                if (!rooms.has(roomId)) {
                    rooms.set(roomId, {
                        host: ws,
                        clients: new Set([ws]),
                        currentUrl: data.url,
                        isHostControl: false
                    });
                    currentRoom = roomId;
                    ws.send(JSON.stringify({
                        type: 'room_created',
                        roomId: roomId,
                        clientId: clientId
                    }));
                } else {
                    const room = rooms.get(roomId);
                    // Dacă clientul este deja în cameră, doar actualizează
                    if (!room.clients.has(ws)) {
                        room.clients.add(ws);
                    }
                    if (ws === room.host || data.isHost) {
                        room.host = ws;
                    }
                    room.currentUrl = data.url;
                    currentRoom = roomId;
                    
                    ws.send(JSON.stringify({
                        type: 'room_created',
                        roomId: roomId,
                        clientId: clientId,
                        isReconnection: true
                    }));
                    
                    // Notifică ceilalți despre reconectare
                    room.clients.forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'user_reconnected',
                                clientId: clientId,
                                currentUrl: room.currentUrl
                            }));
                        }
                    });
                }
                break;

            case 'join_room':
                const room = rooms.get(data.roomId);
                if (room) {
                    room.clients.add(ws);
                    currentRoom = data.roomId;
                    // Notify all clients in the room about the new user
                    room.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'user_joined',
                                clientId: clientId,
                                currentUrl: room.currentUrl
                            }));
                        }
                    });
                }
                break;

            case 'leave_room':
                if (currentRoom) {
                    const leaveRoom = rooms.get(currentRoom);
                    if (leaveRoom) {
                        leaveRoom.clients.delete(ws);
                        if (leaveRoom.clients.size === 0) {
                            rooms.delete(currentRoom);
                        } else {
                            // Notify remaining clients
                            leaveRoom.clients.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({
                                        type: 'user_left',
                                        clientId: clientId
                                    }));
                                }
                            });
                        }
                    }
                    currentRoom = null;
                }
                break;

            case 'sync':
                const syncRoom = rooms.get(currentRoom);
                if (syncRoom) {
                    syncRoom.clients.forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'sync',
                                action: data.action,
                                time: data.time,
                                url: data.url
                            }));
                        }
                    });
                }
                break;

            case 'url_change':
                const urlRoom = rooms.get(currentRoom);
                if (urlRoom) {
                    urlRoom.currentUrl = data.url;
                    
                    // Nu elimina clientul din cameră la schimbarea URL-ului
                    // Doar actualizează URL-ul și notifică ceilalți
                    urlRoom.clients.forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'url_change',
                                url: data.url
                            }));
                        }
                    });
                }
                break;

            case 'toggle_host_control':
                const controlRoom = rooms.get(currentRoom);
                if (controlRoom) {
                    controlRoom.isHostControl = data.isHostControl;
                    controlRoom.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'host_control_toggled',
                                isHostControl: data.isHostControl
                            }));
                        }
                    });
                }
                break;
        }
    });

    ws.on('close', () => {
        if (currentRoom) {
            const room = rooms.get(currentRoom);
            if (room) {
                room.clients.delete(ws);
                if (room.clients.size === 0) {
                    rooms.delete(currentRoom);
                } else {
                    // Notify remaining clients
                    room.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'user_left',
                                clientId: clientId
                            }));
                        }
                    });
                }
            }
        }
        console.log('Client disconnected');
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 