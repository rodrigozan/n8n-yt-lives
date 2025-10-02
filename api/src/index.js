import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { google } from 'googleapis';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Env
const PORT = process.env.PORT || 3000;
const RTMP_URL = process.env.RTMP_URL;
const BASE_VIDEO = process.env.BASE_VIDEO || '/srv/lofi/video/christian-lofi.mp4';
const AUDIO_FILE = process.env.AUDIO_FILE || '/srv/lofi/app/api/audio/playlist.m3u';

const LIVE_TITLE = process.env.LIVE_TITLE || 'Christian Lofi Worship - Lofi Radio 24/7 | Calm Instrumentals for Focus & Study';
const CHANNEL_NAME = process.env.CHANNEL_NAME || 'Aslan Lofi';

const OVERLAY_TRACK_TEMPLATE = process.env.OVERLAY_TRACK_TEMPLATE || '{title} — {artist}';
const TRACK_TITLE = process.env.TRACK_TITLE || 'Lofi Worship Playlist';
const TRACK_ARTIST = process.env.TRACK_ARTIST || 'Varios';

const SHOW_CTA = String(process.env.SHOW_CTA || 'true').toLowerCase() === 'true';
const CTA_TEXT_TEMPLATE = process.env.CTA_TEXT || 'Christian Lofi 24/7 | Calm Instrumentals for Focus & Study • Aslan Lofi';

const TRACK_OVERLAY_SECONDS = Number(process.env.TRACK_OVERLAY_SECONDS || 6);
const CTA_SECONDS = Number(process.env.CTA_SECONDS || 5);

// YouTube API credentials
const YT_CLIENT_ID = process.env.YT_CLIENT_ID;
const YT_CLIENT_SECRET_KEY = process.env.YT_CLIENT_SECRET_KEY;
const YT_REDIRECT_URI = process.env.YT_REDIRECT_URI;

// Estado
let ffmpegProc = null;
let oauth2Client;
let youtube;
let liveChatId = null;
let lastUserMessageTime = Date.now();
let autoMsgInterval;

// -----------------------
// Google OAuth2
// -----------------------
oauth2Client = new google.auth.OAuth2(
  YT_CLIENT_ID,
  YT_CLIENT_SECRET_KEY,
  YT_REDIRECT_URI
);

youtube = google.youtube({ version: 'v3', auth: oauth2Client });

// Carregar tokens do disco se existirem
const TOKENS_PATH = './tokens.json';
if (fs.existsSync(TOKENS_PATH)) {
  const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH));
  oauth2Client.setCredentials(tokens);
  console.log("Tokens carregados do disco.");
}

// rota de login
app.get('/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube.force-ssl']
  });
  res.redirect(url);
});

// rota de callback
app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
  console.log('Tokens salvos em tokens.json');

  res.send('Autorizado com sucesso! Pode iniciar o /stream/start agora.');
});

// -----------------------
// Auto mensagens no chat
// -----------------------
const messages = [
  "🎶 Hi guys, welcome to the live! Where are you watching from?",
  "🙏 Lofi Worship 24/7 — relax, study and pray with us.",
  "✨ Don't forget to like 👍 the stream, it helps a lot!",
  "💬 What's your favorite verse or quote for today?",
  "🎹 Enjoying the music? Share this live with a friend!",
];

async function sendMessageToChat(text) {
  if (!liveChatId) return;
  try {
    await youtube.liveChatMessages.insert({
      part: 'snippet',
      requestBody: {
        snippet: {
          liveChatId,
          type: 'textMessageEvent',
          textMessageDetails: { messageText: text }
        }
      }
    });
    console.log('Mensagem enviada:', text);
  } catch (err) {
    console.error('Erro ao enviar mensagem:', err.message);
  }
}

function startAutoMessages() {
  if (autoMsgInterval) clearInterval(autoMsgInterval);

  autoMsgInterval = setInterval(async () => {
    const now = Date.now();
    const diff = now - lastUserMessageTime;

    if (diff > 60 * 60 * 1000) { 
      console.log('Sem mensagens de usuário por 1h. Pausando envio por 30 min.');
      clearInterval(autoMsgInterval);
      setTimeout(startAutoMessages, 30 * 60 * 1000);
      return;
    }

    const msg = messages[Math.floor(Math.random() * messages.length)];
    await sendMessageToChat(msg);
  }, 10 * 60 * 1000);
}

async function ensureLiveChatId() {
  if (liveChatId) return;
  try {
    const liveRes = await youtube.liveBroadcasts.list({
      part: 'snippet',
      broadcastStatus: 'active',
      broadcastType: 'all'
    });

    if (liveRes.data.items.length > 0) {
      liveChatId = liveRes.data.items[0].snippet.liveChatId;
      console.log('Live chat ativo encontrado:', liveChatId);
    }
  } catch (err) {
    console.error("Erro ao buscar liveChatId:", err.message);
  }
}

// -----------------------
// FFmpeg + Stream
// -----------------------
function sanitizeTextForDrawtext(text) {
  if (!text) return '';
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ');
}

function buildFilterComplex({ trackText, showCTA, ctaText, trackSeconds, ctaSeconds }) {
  const trackTextSan = sanitizeTextForDrawtext(trackText);
  const ctaTextSan = sanitizeTextForDrawtext(ctaText);

  const parts = [];
  parts.push(`[1:a]loudnorm=I=-14:TP=-1.5:LRA=11[aud]`);
  parts.push(
    `[0:v]scale=1280:720,format=yuv420p,` +
      `drawbox=x=0:y=600:w=1280:h=120:color=0x00000088:t=fill:enable='between(t,0,${trackSeconds})',` +
      `drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:` +
      `text='${trackTextSan}':x=20:y=640:fontsize=36:fontcolor=white:` +
      `enable='between(t,0,${trackSeconds})'[vtmp]`
  );

  if (showCTA) {
    parts.push(
      `[vtmp]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:` +
      `text='${ctaTextSan}':x='(w-text_w)/2':y=40:fontsize=30:fontcolor=white:box=1:boxcolor=0x00000088:` +
      `enable='between(t,0,${ctaSeconds})'[vout]`
    );
  } else {
    parts.push(`[vtmp]copy[vout]`);
  }

  return parts.join(';');
}

function startFFmpegOnce({ baseVideo, rtmpUrl, trackText, showCTA, ctaText, trackSeconds, ctaSeconds }) {
  const filter = buildFilterComplex({ trackText, showCTA, ctaText, trackSeconds, ctaSeconds });

  const args = [
    '-stream_loop', '-1', '-re', '-i', baseVideo,
    '-stream_loop', '-1', '-re', '-i', AUDIO_FILE,
    '-filter_complex', filter,
    '-map', '[vout]', '-map', '[aud]',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-b:v', '3000k',
    '-maxrate', '3000k',
    '-bufsize', '6000k',
    '-g', '60',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-ar', '44100',
    '-ac', '2',
    '-f', 'flv', rtmpUrl
  ];

  console.log('Iniciando FFmpeg...');
  console.log('FILTER_COMPLEX:\n', filter);
  ffmpegProc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  ffmpegProc.stdout.on('data', d => process.stdout.write(d.toString()));
  ffmpegProc.stderr.on('data', d => process.stdout.write(d.toString()));
  ffmpegProc.on('close', code => {
    console.log('FFmpeg finalizado com código:', code);
    ffmpegProc = null;
  });
}

// -----------------------
// Rotas
// -----------------------
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    ffmpegRunning: !!ffmpegProc,
    baseVideoExists: fs.existsSync(BASE_VIDEO),
    audioFileExists: fs.existsSync(AUDIO_FILE),
    youtubeAuth: !!oauth2Client.credentials.access_token
  });
});

app.post('/stream/start', async (req, res) => {
  if (ffmpegProc) return res.json({ ok: true, msg: 'Já está transmitindo' });

  if (!RTMP_URL) return res.status(400).json({ ok: false, msg: 'RTMP_URL ausente' });
  if (!fs.existsSync(BASE_VIDEO)) return res.status(400).json({ ok: false, msg: `BASE_VIDEO não encontrado: ${BASE_VIDEO}` });
  if (!fs.existsSync(AUDIO_FILE)) return res.status(400).json({ ok: false, msg: `AUDIO_FILE não encontrado: ${AUDIO_FILE}` });

  await ensureLiveChatId();
  startAutoMessages();

  const title = req.body?.title || TRACK_TITLE;
  const artist = req.body?.artist || TRACK_ARTIST;
  const showCTA = req.body?.showCta ?? SHOW_CTA;
  const ctaTextRaw = req.body?.ctaText || CTA_TEXT_TEMPLATE;

  const trackText = (req.body?.trackText || OVERLAY_TRACK_TEMPLATE)
    .replace('{title}', title)
    .replace('{artist}', artist);

  const ctaText = ctaTextRaw
    .replace('{live_title}', LIVE_TITLE)
    .replace('{channel_name}', CHANNEL_NAME);

  startFFmpegOnce({
    baseVideo: BASE_VIDEO,
    audioFile: AUDIO_FILE,
    rtmpUrl: RTMP_URL,
    trackText,
    showCTA,
    ctaText,
    trackSeconds: TRACK_OVERLAY_SECONDS,
    ctaSeconds: CTA_SECONDS
  });

  res.json({ ok: true, msg: 'Streaming + Auto Messages iniciado' });
});

app.post('/stream/stop', (req, res) => {
  if (!ffmpegProc) return res.status(400).json({ ok: false, msg: 'Não está transmitindo' });
  ffmpegProc.kill('SIGINT');
  ffmpegProc = null;
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
});
