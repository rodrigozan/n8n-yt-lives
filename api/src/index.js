// src/index.js
import express from 'express';
import cors from 'cors';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const RTMP_URL = process.env.RTMP_URL || 'rtmp://a.rtmp.youtube.com/live2/3p2j-2x3u-kha7-51qu-ey9e';
const BASE_VIDEO = process.env.BASE_VIDEO || '/srv/lofi/video/christian-lofi.mp4';
const AUDIO_FILE = process.env.AUDIO_FILE || '/srv/lofi/audio/lofi-worship-playlist.m4a';
const LIVE_TITLE = process.env.LIVE_TITLE || 'Aslan Lofi Worship Chill Music  #lofi #lofichillbeats #lofiworship';
const CHANNEL_NAME = process.env.CHANNEL_NAME || 'Aslan Lofi Worship';
const OVERLAY_TRACK_TEMPLATE = process.env.OVERLAY_TRACK_TEMPLATE || '{title} — {artist}';
const TRACK_TITLE = process.env.TRACK_TITLE || 'Track';
const TRACK_ARTIST = process.env.TRACK_ARTIST || 'Artist';
const SHOW_CTA = String(process.env.SHOW_CTA || 'true').toLowerCase() === 'true';
const CTA_TEXT_TEMPLATE = process.env.CTA_TEXT || 'Live: {live_title} • {channel_name} — Inscreva-se!';
const TRACK_OVERLAY_SECONDS = Number(process.env.TRACK_OVERLAY_SECONDS || 6);
const CTA_SECONDS = Number(process.env.CTA_SECONDS || 5);

let ffmpegProc = null;

function buildFilterComplex({ trackText, showCTA, ctaText, trackSeconds, ctaSeconds }) {
  const trackTextSan = sanitizeTextForDrawtext(trackText);
  const ctaTextSan = sanitizeTextForDrawtext(ctaText);

  const parts = [];

  // Audio loudness normalization
  parts.push(`[1:a]loudnorm=I=-14:TP=-1.5:LRA=11[aud]`);

  // Vídeo: scale para 1280x720 e overlays
  // Caixa preta em y=600, 1280x120; texto da faixa em y=640
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
    '-stream_loop', '-1', '-re', '-i', baseVideo, // vídeo em loop
    '-re', '-i', audioFile,                        // faixa de áudio
    '-filter_complex', filter,
    '-map', '[vout]', '-map', '[aud]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '3000k',
    '-maxrate', '3000k', '-bufsize', '6000k', '-g', '120', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2',
    '-f', 'flv', rtmpUrl
  ];

  console.log('Iniciando FFmpeg...');
  ffmpegProc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  ffmpegProc.stderr.on('data', d => {
    const line = d.toString();
    // Descomente para ver logs detalhados:
    // process.stdout.write(line);
  });

  ffmpegProc.on('close', code => {
    console.log('FFmpeg finalizado com código:', code);
    ffmpegProc = null;
  });
}

app.get('/health', (req, res) => {
  res.json({ ok: true, running: !!ffmpegProc });
});

app.post('/stream/start', (req, res) => {
  if (ffmpegProc) return res.status(400).json({ ok: false, msg: 'Já está transmitindo' });

  // valida arquivos
  if (!fs.existsSync(BASE_VIDEO)) return res.status(400).json({ ok: false, msg: 'BASE_VIDEO inexistente' });
  if (!fs.existsSync(AUDIO_FILE)) return res.status(400).json({ ok: false, msg: 'AUDIO_FILE inexistente' });
  if (!RTMP_URL) return res.status(400).json({ ok: false, msg: 'RTMP_URL ausente' });

  const trackText = OVERLAY_TRACK_TEMPLATE
    .replace('{title}', TRACK_TITLE)
    .replace('{artist}', TRACK_ARTIST);

  const ctaText = CTA_TEXT_TEMPLATE
    .replace('{live_title}', LIVE_TITLE)
    .replace('{channel_name}', CHANNEL_NAME);

  startFFmpegOnce({
    baseVideo: BASE_VIDEO,
    audioFile: AUDIO_FILE,
    rtmpUrl: RTMP_URL,
    trackText,
    showCTA: SHOW_CTA,
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
