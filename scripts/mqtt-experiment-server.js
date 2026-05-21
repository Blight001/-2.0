const net = require('net');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const aedesFactory = require('aedes');

const brokerPort = Number.parseInt(process.env.MQTT_EXPERIMENT_BROKER_PORT || process.env.MQTT_BROKER_PORT || '1883', 10) || 1883;
const httpPort = Number.parseInt(process.env.MQTT_EXPERIMENT_HTTP_PORT || process.env.MQTT_HTTP_PORT || '3000', 10) || 3000;
const topicPrefix = String(process.env.MQTT_TOPIC_PREFIX || process.env.REG_CONTROL_MQTT_TOPIC_PREFIX || 'registration').trim() || 'registration';

const broker = aedesFactory();
const clients = new Map();
const pendingResponses = new Map();

function escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeJsonParse(text, fallback = null) {
    try {
        return JSON.parse(text);
    } catch (_) {
        return fallback;
    }
}

function topicMatch(suffix, topic) {
    const pattern = new RegExp(`^${escapeRegex(topicPrefix)}/${suffix}$`);
    return pattern.test(topic);
}

function ensureClientRecord(clientId) {
    const key = String(clientId || '').trim();
    if (!key) {
        return null;
    }

    const current = clients.get(key) || {
        clientId: key,
        state: null,
        presence: null,
        connected: false,
        lastRequest: null,
        lastResponse: null,
        lastSeenAt: null,
        connectedAt: null,
        disconnectedAt: null,
        messages: [],
    };
    clients.set(key, current);
    return current;
}

function recordMessage(record, kind, payload) {
    if (!record) {
        return;
    }

    record.messages.push({
        kind,
        payload,
        recordedAt: new Date().toISOString(),
    });
    if (record.messages.length > 50) {
        record.messages = record.messages.slice(-50);
    }
    record.lastSeenAt = new Date().toISOString();
}

function updateRecordFromTopic(topic, payload) {
    const base = `${topicPrefix}/clients/`;
    if (topic.startsWith(`${base}`) && topic.endsWith('/state')) {
        const clientId = topic.slice(base.length, -('/state'.length));
        const record = ensureClientRecord(clientId);
        if (!record) {
            return;
        }
        record.state = payload;
        record.lastSeenAt = new Date().toISOString();
        recordMessage(record, 'state', payload);
        return;
    }

    if (topic.startsWith(`${base}`) && topic.endsWith('/presence')) {
        const clientId = topic.slice(base.length, -('/presence'.length));
        const record = ensureClientRecord(clientId);
        if (!record) {
            return;
        }
        record.presence = payload;
        record.connected = String(payload?.status || '').toLowerCase() === 'online';
        if (record.connected && !record.connectedAt) {
            record.connectedAt = new Date().toISOString();
        }
        if (!record.connected) {
            record.disconnectedAt = new Date().toISOString();
        }
        recordMessage(record, 'presence', payload);
        return;
    }

    if (topic.startsWith(`${base}`) && topic.endsWith('/response')) {
        const clientId = topic.slice(base.length, -('/response'.length));
        const record = ensureClientRecord(clientId);
        if (!record) {
            return;
        }
        record.lastResponse = payload;
        record.lastSeenAt = new Date().toISOString();
        recordMessage(record, 'response', payload);

        const requestId = String(payload?.request_id || payload?.requestId || '').trim();
        if (requestId && pendingResponses.has(requestId)) {
            const pending = pendingResponses.get(requestId);
            pendingResponses.delete(requestId);
            clearTimeout(pending.timer);
            pending.resolve(payload);
        }
        return;
    }

    if (topic.startsWith(`${topicPrefix}/server/request`)) {
        const clientId = String(payload?.client_id || payload?.clientId || '').trim();
        const record = ensureClientRecord(clientId);
        if (!record) {
            return;
        }
        record.lastRequest = payload;
        record.lastSeenAt = new Date().toISOString();
        recordMessage(record, 'request', payload);

        const replyTopic = String(payload?.reply_topic || payload?.replyTopic || '').trim();
        const requestId = String(payload?.request_id || payload?.requestId || '').trim();
        if (replyTopic && requestId) {
            publish(replyTopic, {
                ok: true,
                request_id: requestId,
                command: String(payload?.command || ''),
                message: 'ack',
                server_time: new Date().toISOString(),
            }).catch((error) => {
                console.error('[MQTT-EXP] reply publish failed:', error.message);
            });
        }
    }
}

function createCommandEnvelope(clientId, command, payload = {}, replyTopic = '') {
    const requestId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return {
        request_id: requestId,
        command,
        payload: payload && typeof payload === 'object' ? payload : {},
        client_id: clientId,
        reply_topic: replyTopic || `${topicPrefix}/clients/${clientId}/response`,
        requested_at: new Date().toISOString(),
    };
}

async function waitForResponse(requestId, timeoutMs = 8000) {
    return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pendingResponses.delete(requestId);
            reject(new Error(`响应超时 (${timeoutMs}ms)`));
        }, timeoutMs);

        pendingResponses.set(requestId, {
            timer,
            resolve,
            reject,
        });
    });
}

async function publish(topic, payload) {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    await new Promise((resolve, reject) => {
        broker.publish({ topic, payload: body, qos: 0, retain: false }, (error) => {
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        });
    });
}

async function sendClientCommand(clientId, command, payload = {}, options = {}) {
    const record = ensureClientRecord(clientId);
    if (!record) {
        throw new Error('clientId 不能为空');
    }

    const replyTopic = String(options.replyTopic || `${topicPrefix}/clients/${clientId}/response`).trim();
    const envelope = createCommandEnvelope(clientId, command, payload, replyTopic);
    const commandTopic = `${topicPrefix}/clients/${clientId}/cmd`;

    await publish(commandTopic, envelope);

    if (options.waitForResponse === false) {
        return {
            ok: true,
            request_id: envelope.request_id,
            command,
            topic: commandTopic,
        };
    }

    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 8000;
    const responsePromise = waitForResponse(envelope.request_id, timeoutMs);
    record.lastRequest = envelope;
    recordMessage(record, 'command', envelope);
    const response = await responsePromise;
    return {
        ok: true,
        request_id: envelope.request_id,
        command,
        topic: commandTopic,
        response,
    };
}

function renderDashboard() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MQTT 控制实验服务器</title>
    <style>
        :root { color-scheme: dark; }
        body {
            margin: 0;
            font-family: "Microsoft YaHei", system-ui, sans-serif;
            background: linear-gradient(180deg, #101826 0%, #0b1220 100%);
            color: #e8eefc;
        }
        header {
            padding: 20px 24px 10px;
            border-bottom: 1px solid rgba(255,255,255,0.08);
        }
        h1 { margin: 0 0 8px; font-size: 20px; }
        .sub { color: #9fb0d0; font-size: 13px; }
        main { padding: 18px 24px 28px; display: grid; gap: 16px; }
        .grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 16px; }
        .card {
            background: rgba(17, 25, 38, 0.9);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 16px;
            padding: 16px;
            box-shadow: 0 24px 50px rgba(0,0,0,0.28);
        }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 10px 8px; border-bottom: 1px solid rgba(255,255,255,0.08); text-align: left; font-size: 13px; }
        th { color: #9fb0d0; font-weight: 600; }
        input, textarea, select, button {
            width: 100%;
            box-sizing: border-box;
            margin-top: 8px;
            padding: 10px 12px;
            border-radius: 10px;
            border: 1px solid rgba(255,255,255,0.1);
            background: rgba(255,255,255,0.05);
            color: #eef3ff;
            font-size: 13px;
        }
        textarea { min-height: 110px; resize: vertical; }
        button {
            cursor: pointer;
            background: linear-gradient(180deg, #3b82f6 0%, #2563eb 100%);
            border: none;
            font-weight: 700;
        }
        button:hover { filter: brightness(1.05); }
        .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        pre {
            white-space: pre-wrap;
            word-break: break-word;
            background: rgba(255,255,255,0.04);
            border-radius: 12px;
            padding: 12px;
            overflow: auto;
            max-height: 280px;
        }
        .muted { color: #90a4ca; }
    </style>
</head>
<body>
    <header>
        <h1>MQTT 控制实验服务器</h1>
        <div class="sub">Broker: ${brokerPort} | HTTP: ${httpPort} | Prefix: ${topicPrefix}</div>
    </header>
    <main>
        <div class="grid">
            <div class="card">
                <h2>客户端</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Client</th>
                            <th>Online</th>
                            <th>Last Seen</th>
                            <th>Connected At</th>
                        </tr>
                    </thead>
                    <tbody id="clients-body"></tbody>
                </table>
            </div>
            <div class="card">
                <h2>发送命令</h2>
                <label>目标客户端</label>
                <input id="client-id" placeholder="client id">
                <label>命令</label>
                <input id="command" value="get_web_snapshot">
                <label>Payload JSON</label>
                <textarea id="payload">{}</textarea>
                <button id="send-btn">发送</button>
                <div class="muted" style="margin-top:10px;">结果</div>
                <pre id="result">等待操作</pre>
            </div>
        </div>
        <div class="grid">
            <div class="card">
                <h2>批量广播</h2>
                <div class="row">
                    <div>
                        <label>Group</label>
                        <input id="group-id" placeholder="可留空">
                    </div>
                    <div>
                        <label>Broadcast</label>
                        <input id="broadcast-command" value="update_control_state">
                    </div>
                </div>
                <label>Payload JSON</label>
                <textarea id="broadcast-payload">{"controlLocked":true}</textarea>
                <button id="broadcast-btn">广播发送</button>
            </div>
            <div class="card">
                <h2>状态详情</h2>
                <pre id="detail">点击某个客户端查看详情</pre>
            </div>
        </div>
    </main>
    <script>
        const state = { clients: [] };
        const clientsBody = document.getElementById('clients-body');
        const detail = document.getElementById('detail');
        const result = document.getElementById('result');

        async function refresh() {
            const response = await fetch('/api/clients');
            const payload = await response.json();
            state.clients = Array.isArray(payload.clients) ? payload.clients : [];
            clientsBody.innerHTML = state.clients.map((client) => {
                return '<tr data-client="' + client.clientId + '">' +
                    '<td>' + client.clientId + '</td>' +
                    '<td>' + (client.connected ? 'online' : 'offline') + '</td>' +
                    '<td>' + (client.lastSeenAt || '-') + '</td>' +
                    '<td>' + (client.connectedAt || '-') + '</td>' +
                '</tr>';
            }).join('') || '<tr><td colspan="4">暂无客户端</td></tr>';

            clientsBody.querySelectorAll('tr[data-client]').forEach((row) => {
                row.addEventListener('click', async () => {
                    const clientId = row.getAttribute('data-client');
                    document.getElementById('client-id').value = clientId;
                    const detailResponse = await fetch('/api/clients/' + encodeURIComponent(clientId));
                    const detailPayload = await detailResponse.json();
                    detail.textContent = JSON.stringify(detailPayload, null, 2);
                });
            });
        }

        async function sendJson(url, body) {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || '请求失败');
            }
            return data;
        }

        document.getElementById('send-btn').addEventListener('click', async () => {
            try {
                const clientId = document.getElementById('client-id').value.trim();
                const command = document.getElementById('command').value.trim();
                const payload = JSON.parse(document.getElementById('payload').value || '{}');
                const data = await sendJson('/api/clients/' + encodeURIComponent(clientId) + '/cmd', { command, payload });
                result.textContent = JSON.stringify(data, null, 2);
            } catch (error) {
                result.textContent = error.message;
            }
        });

        document.getElementById('broadcast-btn').addEventListener('click', async () => {
            try {
                const groupId = document.getElementById('group-id').value.trim();
                const command = document.getElementById('broadcast-command').value.trim();
                const payload = JSON.parse(document.getElementById('broadcast-payload').value || '{}');
                const url = groupId ? '/api/groups/' + encodeURIComponent(groupId) + '/cmd' : '/api/broadcast/cmd';
                const data = await sendJson(url, { command, payload });
                result.textContent = JSON.stringify(data, null, 2);
            } catch (error) {
                result.textContent = error.message;
            }
        });

        setInterval(refresh, 2000);
        refresh();
    </script>
</body>
</html>`;
}

async function main() {
    const brokerServer = net.createServer(broker.handle);
    brokerServer.listen(brokerPort, '0.0.0.0', () => {
        console.log(`[MQTT-EXP] broker listening on ${brokerPort}`);
    });

    broker.on('publish', (packet, client) => {
        if (!packet || !packet.topic) {
            return;
        }
        const text = Buffer.isBuffer(packet.payload) ? packet.payload.toString('utf8') : String(packet.payload || '');
        const payload = safeJsonParse(text, { raw: text });
        updateRecordFromTopic(packet.topic, payload);
        if (client && client.id) {
            const record = ensureClientRecord(client.id);
            if (record) {
                record.lastSeenAt = new Date().toISOString();
            }
        }
    });

    broker.on('client', (client) => {
        const record = ensureClientRecord(client?.id || '');
        if (!record) {
            return;
        }
        record.connected = true;
        record.connectedAt = new Date().toISOString();
        record.lastSeenAt = record.connectedAt;
        recordMessage(record, 'broker-client', { event: 'client', id: client.id });
    });

    broker.on('clientDisconnect', (client) => {
        const record = ensureClientRecord(client?.id || '');
        if (!record) {
            return;
        }
        record.connected = false;
        record.disconnectedAt = new Date().toISOString();
        recordMessage(record, 'broker-client', { event: 'disconnect', id: client.id });
    });

    const app = express();
    app.use(express.json({ limit: '2mb' }));

    app.get('/health', (_req, res) => {
        res.json({
            ok: true,
            brokerPort,
            httpPort,
            topicPrefix,
            clientCount: clients.size,
        });
    });

    app.get('/api/clients', (_req, res) => {
        res.json({
            ok: true,
            clients: Array.from(clients.values()).map((client) => ({
                clientId: client.clientId,
                connected: client.connected,
                lastSeenAt: client.lastSeenAt,
                connectedAt: client.connectedAt,
                disconnectedAt: client.disconnectedAt,
                presence: client.presence,
                state: client.state,
                lastRequest: client.lastRequest,
                lastResponse: client.lastResponse,
            })),
        });
    });

    app.get('/api/clients/:clientId', (req, res) => {
        const client = clients.get(String(req.params.clientId || '').trim());
        if (!client) {
            res.status(404).json({ ok: false, error: 'client not found' });
            return;
        }
        res.json({ ok: true, client });
    });

    app.post('/api/clients/:clientId/cmd', async (req, res) => {
        try {
            const clientId = String(req.params.clientId || '').trim();
            const command = String(req.body?.command || '').trim();
            const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
            if (!clientId) {
                res.status(400).json({ ok: false, error: 'clientId is required' });
                return;
            }
            if (!command) {
                res.status(400).json({ ok: false, error: 'command is required' });
                return;
            }
            const response = await sendClientCommand(clientId, command, payload, {
                timeoutMs: Number(req.body?.timeoutMs) > 0 ? Number(req.body.timeoutMs) : 8000,
            });
            res.json(response);
        } catch (error) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/groups/:groupId/cmd', async (req, res) => {
        try {
            const groupId = String(req.params.groupId || '').trim();
            const command = String(req.body?.command || '').trim();
            const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
            if (!groupId) {
                res.status(400).json({ ok: false, error: 'groupId is required' });
                return;
            }
            if (!command) {
                res.status(400).json({ ok: false, error: 'command is required' });
                return;
            }
            const requestId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            const replyTopic = `${topicPrefix}/groups/${groupId}/response`;
            const envelope = {
                request_id: requestId,
                command,
                payload,
                group_id: groupId,
                reply_topic: replyTopic,
                requested_at: new Date().toISOString(),
            };
            const targetTopic = `${topicPrefix}/groups/${groupId}/cmd`;
            await publish(targetTopic, envelope);
            res.json({
                ok: true,
                request_id: requestId,
                topic: targetTopic,
                dispatched: true,
            });
        } catch (error) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/broadcast/cmd', async (req, res) => {
        try {
            const command = String(req.body?.command || '').trim();
            const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
            if (!command) {
                res.status(400).json({ ok: false, error: 'command is required' });
                return;
            }
            const requestId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            const targetTopic = `${topicPrefix}/broadcast/cmd`;
            const envelope = {
                request_id: requestId,
                command,
                payload,
                reply_topic: `${topicPrefix}/broadcast/response`,
                requested_at: new Date().toISOString(),
            };
            await publish(targetTopic, envelope);
            res.json({
                ok: true,
                request_id: requestId,
                topic: targetTopic,
                dispatched: true,
            });
        } catch (error) {
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    app.get('/', (_req, res) => {
        res.type('html').send(renderDashboard());
    });

    const httpServer = http.createServer(app);
    httpServer.listen(httpPort, '0.0.0.0', () => {
        console.log(`[MQTT-EXP] http listening on ${httpPort}`);
    });
}

main().catch((error) => {
    console.error('[MQTT-EXP] failed:', error);
    process.exitCode = 1;
});
