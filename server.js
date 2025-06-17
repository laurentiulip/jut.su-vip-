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

// Funcție pentru curățarea camerelor goale
function cleanupRooms() {
    rooms.forEach((room, roomId) => {
        // Elimină clienții deconectați
        const connectedClients = new Set();
        room.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                connectedClients.add(client);
            }
        });
        
        if (connectedClients.size === 0) {
            rooms.delete(roomId);
            console.log(`Deleted empty room: ${roomId}`);
        } else {
            room.clients = connectedClients;
            // Dacă host-ul nu mai este conectat, alege un nou host
            if (!connectedClients.has(room.host) || room.host.readyState !== WebSocket.OPEN) {
                room.host = connectedClients.values().next().value;
                console.log(`New host assigned for room ${roomId}`);
            }
        }
    });
}

// Rulează curățarea la fiecare 30 de secunde
setInterval(cleanupRooms, 30000);

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
                        hostId: clientId,
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
                    console.log(`Room ${roomId} created by ${clientId}`);
                } else {
                    const room = rooms.get(roomId);
                    // Verifică dacă este același host care se reconectează
                    if (room.hostId === clientId || !room.clients.has(room.host) || room.host.readyState !== WebSocket.OPEN) {
                        room.host = ws;
                        room.hostId = clientId;
                    }
                    
                    if (!room.clients.has(ws)) {
                        room.clients.add(ws);
                    }
                    room.currentUrl = data.url;
                    currentRoom = roomId;
                    
                    ws.send(JSON.stringify({
                        type: 'room_created',
                        roomId: roomId,
                        clientId: clientId,
                        isReconnection: true
                    }));
                    
                    // Notifică ceilalți despre reconectarea host-ului
                    room.clients.forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'host_reconnected',
                                clientId: clientId,
                                currentUrl: room.currentUrl
                            }));
                        }
                    });
                    console.log(`Host ${clientId} reconnected to room ${roomId}`);
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
        console.log(`Client ${clientId} disconnected`);
        if (currentRoom) {
            const room = rooms.get(currentRoom);
            if (room) {
                // Nu elimina imediat clientul - poate se reconectează
                setTimeout(() => {
                    // Verifică dacă clientul s-a reconectat
                    if (room.clients.has(ws) && ws.readyState !== WebSocket.OPEN) {
                        room.clients.delete(ws);
                        
                        if (room.clients.size === 0) {
                            rooms.delete(currentRoom);
                            console.log(`Room ${currentRoom} deleted - no clients`);
                        } else {
                            // Notifică clienții rămași
                            room.clients.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({
                                        type: 'user_left',
                                        clientId: clientId
                                    }));
                                }
                            });
                            
                            // Dacă host-ul a plecat, alege unul nou
                            if (room.host === ws) {
                                room.host = room.clients.values().next().value;
                                console.log(`New host assigned for room ${currentRoom}`);
                            }
                        }
                    }
                }, 5000); // Așteaptă 5 secunde pentru reconectare
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
}); 