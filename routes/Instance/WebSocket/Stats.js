const express = require('express');
const router = express.Router();
const WebSocket = require('ws');
const { db } = require('../../../handlers/db.js');
const { isUserAuthorizedForContainer } = require('../../../utils/authHelper');

router.ws("/stats/:id", async (ws, req) => {

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
        const volume = instance.VolumeId;

        if (!node?.address || !node?.port)
            return ws.close(1011, "Invalid node config");

        let socket;
        let reconnectAttempts = 0;
        let heartbeatInterval;
        let lastSent = 0;

        const connectToNode = () => {

            socket = new WebSocket(
                `ws://${node.address}:${node.port}/stats/${instance.ContainerId}/${volume}`,
                { perMessageDeflate: false }
            );

            socket.on('open', () => {
                reconnectAttempts = 0;

                socket.send(JSON.stringify({
                    event: "auth",
                    args: [node.apiKey]
                }));

                // heartbeat
                heartbeatInterval = setInterval(() => {
                    if (socket.readyState === WebSocket.OPEN) {
                        socket.ping();
                    }
                }, 15000);
            });

            socket.on('message', (data) => {

                // 🔥 throttle 200ms để tránh spam UI
                const now = Date.now();
                if (now - lastSent < 200) return;
                lastSent = now;

                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(data);
                }
            });

            socket.on('close', () => {
                clearInterval(heartbeatInterval);

                if (reconnectAttempts < 5) {
                    reconnectAttempts++;
                    setTimeout(connectToNode, 2000);
                } else {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            error: "Stats daemon offline"
                        }));
                    }
                }
            });

            socket.on('error', () => {});
        };

        connectToNode();

        ws.on('close', () => {
            clearInterval(heartbeatInterval);
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.close();
            }
        });

        ws.on('error', () => {});

    } catch (err) {
        console.error("Stats WS Error:", err);
        ws.close(1011, "Internal error");
    }

});

module.exports = router;