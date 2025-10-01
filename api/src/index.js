import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Env
const PORT = process.env.PORT || 3000;
const RTMP_URL = process.env.RTMP_URL;
const BASE_VIDEO = process.env.BASE_VIDEO || '/srv/lofi/video/christian-lofi.mp4';
const AUDIO_FILE = process.env.AUDIO_FILE || '/srv/lofi/audio/lofi-worship-playlist.m4a';

const LIVE_TITLE = process.env.LIVE_TITLE || 'Christian Lofi 24/7 Teste';
const CHANNEL_NAME = process.env.CHANNEL_NAME || 'Aslan Lofi';

const OVERLAY_TRACK_TEMPLATE = process.env.OVERLAY_TRACK_TEMPLATE || '{title} — {artist}';
const TRACK_TITLE = process.env.TRACK_TITLE || 'Lofi Worship Playlist';
const TRACK_ARTIST = process.env.TRACK_ARTIST || 'Varios';

const SHOW_CTA = String(process.env.SHOW_CTA || 'true').toLowerCase() === 'true';
const CTA_TEXT_TEMPLATE = process.env.CTA_TEXT || 'Christian Lofi 24/7 | Calm Instrumentals for Focus & Study • Aslan Lofi';

const TRACK_OVERLAY_SECONDS = Number(process.env.TRACK_OVERLAY_SECONDS || 6);
const CTA_SECONDS = Number(process.env.CTA_SECONDS || 5);

// Estado
let ffmpegProc = null;

// Util: sanitiza texto para drawtext
function sanitizeTextForDrawtext(text) {
  if (!text) return '';
  return String(text)
    .replace(/\\/g, '\\\\')  // barra invertida
    .replace(/:/g, '\\:')    // dois-pontos
    .replace(/'/g, "\\'")    // aspas simples
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ');
}

// Monta exatamente o filtro que funcionou no seu teste manual:
// scale 1280x720, caixa inferior fixa e CTA no topo.
function buildFilterComplex({ trackText, showCTA, ctaText, trackSeconds, ctaSeconds }) {
  const trackTextSan = sanitizeTextForDrawtext(trackText);
  const ctaTextSan = sanitizeTextForDrawtext(ctaText);

  const parts = [];
  // Áudio
  parts.push(`[1:a]loudnorm=I=-14:TP=-1.5:LRA=11[aud]`);
  // Vídeo base + overlays
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

function startFFmpegOnce({ baseVideo, audioFile, rtmpUrl, trackText, showCTA, ctaText, trackSeconds, ctaSeconds }) {
  const filter = buildFilterComplex({ trackText, showCTA, ctaText, trackSeconds, ctaSeconds });

  const args = [
    '-stream_loop', '-1', '-re', '-i', baseVideo,
'-stream_loop', '-1', '-re', '-f', 'concat', '-safe', '0', '-i', '/srv/lofi/audio/playlist.txt',
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

// Rotas
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    ffmpegRunning: !!ffmpegProc,
    baseVideoExists: fs.existsSync(BASE_VIDEO),
    audioFileExists: fs.existsSync(AUDIO_FILE)
  });
});

app.post('/stream/start', (req, res) => {
  if (ffmpegProc) return res.json({ ok: true, msg: 'Já está transmitindo' });

  if (!RTMP_URL) return res.status(400).json({ ok: false, msg: 'RTMP_URL ausente' });
  if (!fs.existsSync(BASE_VIDEO)) return res.status(400).json({ ok: false, msg: `BASE_VIDEO não encontrado: ${BASE_VIDEO}` });
  if (!fs.existsSync(AUDIO_FILE)) return res.status(400).json({ ok: false, msg: `AUDIO_FILE não encontrado: ${AUDIO_FILE}` });

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

  res.json({ ok: true });
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
