const WebSocket = require('ws');

// Renderが指定するポート、またはローカル用の3000番ポートを使用
const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

let totalCounter = 0;      // 累計使用者数
let clients = [];          // 接続中のクライアント一覧
let currentUser = null;    // 現在操作中のクライアント
let queue = [];            // 待ちリストの配列
let currentIntensity = 0;  // 現在の強度 (0〜100)
let timerSeconds = 120;    // 残り時間（秒）
let timerInterval = null;  // タイマーのインターバル

console.log(`WebSocket server started on port ${PORT}`);

// 2分タイマーの処理
function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerSeconds = 120;

  timerInterval = setInterval(() => {
    if (timerSeconds > 0) {
      timerSeconds--;
    } else {
      // 2分経過したら次の人に交代
      nextUser();
    }
    broadcastState();
  }, 1000);
}

// 次のユーザーへ交代する処理
function nextUser() {
  if (queue.length > 0) {
    currentUser = queue.shift(); // 待ちの先頭を現在の操作者に
    currentIntensity = 0;       // 交代時は安全のため強度を0に
    startTimer();
  } else {
    currentUser = null;         // 誰も並んでいなければ空に
    currentIntensity = 0;
    if (timerInterval) clearInterval(timerInterval);
  }
}

// 全員に現在の状態を配信する
function broadcastState() {
  const state = {
    type: 'STATE_UPDATE',
    totalUsers: totalCounter,
    currentUser: currentUser ? currentUser.id : null,
    queue: queue.map(c => c.id),
    timer: timerSeconds,
    intensity: currentIntensity
  };

  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(state));
    }
  });
}

wss.on('connection', (ws) => {
  totalCounter++;
  const clientId = `#${String(totalCounter).padStart(2, '0')}`;
  const client = { id: clientId, ws: ws };
  clients.push(client);

  console.log(`Client connected: ${clientId}`);

  // もし操作者がいないなら、即座に操作権をあたえる
  if (!currentUser) {
    currentUser = client;
    startTimer();
  } else {
    // すでにいれば待ちリストへ追加
    queue.push(client);
  }

  broadcastState();

  // クライアントからのメッセージ受信
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // 操作権を持っている人からの強度変更命令のみ受け付ける
      if (data.type === 'CHANGE_INTENSITY' && currentUser && currentUser.id === clientId) {
        currentIntensity = Math.max(0, Math.min(100, Number(data.intensity) || 0));
        broadcastState();
      }
    } catch (e) {
      console.error('Invalid message format', e);
    }
  });

  // 切断時の処理
  ws.on('close', () => {
    console.log(`Client disconnected: ${clientId}`);
    clients = clients.filter(c => c !== ws);

    if (currentUser && currentUser.id === clientId) {
      // 操作中の人が抜けたら次の人に交代
      nextUser();
    } else {
      // 待ちリストから削除
      queue = queue.filter(c => c.id !== clientId);
    }
    broadcastState();
  });
});