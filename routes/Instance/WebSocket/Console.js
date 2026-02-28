const express = require('express');
const router = express.Router();
const WebSocket = require('ws');
const { db } = require('../../../handlers/db.js');
const { isUserAuthorizedForContainer } = require('../../../utils/authHelper');

router.ws("/console/:id", async (ws, req) => {

    try {
        if (!req.user) return ws.close(1008, "Authorization required");

        const { id } = req.params;
        if (!id) return ws.close(1008, "Invalid ID");

        const instance = await db.get(id + '_instance');
        if (!instance) return ws.close(1008, "Instance not found");

        const isAuthorized = await isUserAuthorizedForContainer(
            req.user.userId,
            instance.Id
        );
        if (!isAuthorized) return ws.close(1008, "Unauthorized access");

        if (instance.suspended === true)
            return ws.close(1008, "Instance suspended");

        const node = instance.Node;
        if (!node?.address || !node?.port)
            return ws.close(1011, "Invalid node configuration");

        let socket;
        let reconnectAttempts = 0;
        let heartbeatInterval;

        const connectToNode = () => {

            socket = new WebSocket(
                `ws://${node.address}:${node.port}/exec/${instance.ContainerId}`,
                {
                    perMessageDeflate: false // giảm CPU delay
                }
            );

            socket.on('open', () => {
                reconnectAttempts = 0;

                // auth
                socket.send(JSON.stringify({
                    event: "auth",
                    args: [node.apiKey]
                }));

                // heartbeat mỗi 15s
                heartbeatInterval = setInterval(() => {
                    if (socket.readyState === WebSocket.OPEN) {
                        socket.ping();
                    }
                }, 15000);
            });

            socket.on('message', (data) => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(data);
                }
            });

            socket.on('close', () => {
                clearInterval(heartbeatInterval);

                // auto reconnect tối đa 5 lần
                if (reconnectAttempts < 5) {
                    reconnectAttempts++;
                    setTimeout(connectToNode, 2000);
                } else {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send('\x1b[31mDaemon offline.\x1b[0m\n');
                    }
                }
            });

            socket.on('error', () => {
                // tránh crash server
            });
        };

        connectToNode();

        // Client gửi lệnh
        ws.on('message', (msg) => {
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(msg);
            }
        });

        ws.on('close', () => {
            clearInterval(heartbeatInterval);
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.close();
            }
        });

        ws.on('error', () => {});

    } catch (err) {
        console.error("Console WS Error:", err);
        ws.close(1011, "Internal error");
    }

});

module.exports = router;