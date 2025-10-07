import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { google } from "googleapis";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Env
const PORT = process.env.PORT || 3000;
const RTMP_URL = process.env.RTMP_URL;
const BASE_VIDEO = process.env.BASE_VIDEO;
const AUDIO_FILE = process.env.AUDIO_FILE;

const LIVE_TITLE =
  process.env.LIVE_TITLE ||
  "Christian Lofi Worship - Lofi Radio 24/7 | Calm Instrumentals for Focus & Study";
const CHANNEL_NAME = process.env.CHANNEL_NAME || "Aslan Lofi";

const OVERLAY_TRACK_TEMPLATE =
  process.env.OVERLAY_TRACK_TEMPLATE || "{title} — {artist}";
const TRACK_TITLE = process.env.TRACK_TITLE || "Lofi Worship Playlist";
const TRACK_ARTIST = process.env.TRACK_ARTIST || "Varios";

const SHOW_CTA =
  String(process.env.SHOW_CTA || "true").toLowerCase() === "true";
const CTA_TEXT_TEMPLATE =
  process.env.CTA_TEXT ||
  "Christian Lofi 24/7 | Calm Instrumentals for Focus & Study • Aslan Lofi";

const TRACK_OVERLAY_SECONDS = Number(process.env.TRACK_OVERLAY_SECONDS || 6);
const CTA_SECONDS = Number(process.env.CTA_SECONDS || 5);
const FONT_FILE = process.env.FONT_FILE || '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

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
let lastStreamParams = null;
const RESTART_DELAY_MS = 30000; 

// -----------------------
// Google OAuth2
// -----------------------
oauth2Client = new google.auth.OAuth2(
  YT_CLIENT_ID,
  YT_CLIENT_SECRET_KEY,
  YT_REDIRECT_URI
);

youtube = google.youtube({ version: "v3", auth: oauth2Client });

// Carregar tokens do disco
const TOKENS_PATH = "./tokens.json";
if (fs.existsSync(TOKENS_PATH)) {
  const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH));
  oauth2Client.setCredentials(tokens);
  console.log("Tokens carregados do disco.");
}

// Refresh automático
oauth2Client.on("tokens", (tokens) => {
  if (tokens.refresh_token || tokens.access_token) {
    const current = fs.existsSync(TOKENS_PATH)
      ? JSON.parse(fs.readFileSync(TOKENS_PATH))
      : {};
    const newTokens = { ...current, ...tokens };
    fs.writeFileSync(TOKENS_PATH, JSON.stringify(newTokens, null, 2));
    console.log("Tokens atualizados e salvos em tokens.json");
  }
});

// -----------------------
// Utils
// -----------------------
function sanitizeTextForDrawtext(text) {
  if (!text) return "";
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\n/g, " ")
    .replace(/\r/g, " ");
}

function buildFilterComplex({
  trackText,
  showCTA,
  ctaText,
  trackSeconds,
  ctaSeconds,
}) {
  const trackTextSan = sanitizeTextForDrawtext(trackText);
  const ctaTextSan = sanitizeTextForDrawtext(ctaText);

  const parts = [];
  parts.push(`[1:a]loudnorm=I=-14:TP=-1.5:LRA=11[aud]`);
  parts.push(
    `[0:v]scale=1280:720,format=yuv420p,` +
      `drawbox=x=0:y=600:w=1280:h=120:color=0x00000088:t=fill:enable='between(t,0,${trackSeconds})',` +
      `drawtext=fontfile=${FONT_FILE}:` +
      `text='${trackTextSan}':x=20:y=640:fontsize=36:fontcolor=white:` +
      `enable='between(t,0,${trackSeconds})'[vtmp]`
  );

  if (showCTA) {
    parts.push(
      `[vtmp]drawtext=fontfile=${FONT_FILE}:` +
        `text='${ctaTextSan}':x='(w-text_w)/2':y=40:fontsize=30:fontcolor=white:box=1:boxcolor=0x00000088:` +
        `enable='between(t,0,${ctaSeconds})'[vout]`
    );
  } else {
    parts.push(`[vtmp]copy[vout]`);
  }

  return parts.join(";");
}

const messages = [
  "🎶 Hi guys, welcome to the live! Where are you watching from?",
  "🙏 Lofi Worship 24/7 — relax, study and pray with us.",
  "✨ Don't forget to like 👍 the stream, it helps a lot!",
  "💬 What's your favorite verse or quote for today?",
  "🎹 Enjoying the music? Share this live with a friend!",
  "✨ Where are you tuning in from?",
  "📚 Time to focus, let's get this study session started.",
  "🌙 Perfect vibes for a late night.",
  "☕ Who else is studying with coffee right now?",
  "💬 What are you working on today?",
  "🎶 Music + focus = productivity unlocked.",
  "💤 Anyone else pulling an all-nighter?",
  "🌸 Don't forget to take breaks and drink some water.",
  "📖 Study hard now, thank yourself later.",
  "🔥 Let's stay motivated together!",
  "🌍 Love how this chat is so global.",
  "🖊️ Writing essays with these vibes feels easier.",
  "💡 Quick tip: 25 min study, 5 min break = focus mode.",
  "🌈 Good luck to everyone grinding tonight!",
  "💻 Coding with lofi hits different.",
  "🍵 Tea + lofi = ultimate chill combo.",
  "🎓 Sending good vibes to everyone with exams soon!",
  "✍️ What's your subject today?",
  "🙏 Stay positive, you've got this!",
  "🌌 Night owls, assemble!",
  "🎧 Headphones on, world off.",
  "🥱 Long day but the grind doesn’t stop.",
  "💭 Anyone else just vibing and not studying?",
  "📅 New month, new goals!",
  "🎹 This beat is so smooth…",
  "📊 Productivity vibes only.",
  "🌞 Good morning from my side of the world!",
  "📎 Remember: progress, not perfection.",
  "✨ Small steps every day make a big difference.",
  "💪 Stay strong, friends, we're in this together.",
  "🎶 Praising God while we study and meditate on His Word.",
  "🙏 Let's pray together in this moment of peace and focus.",
  "✨ May these melodies bless your heart and mind.",
  "📖 Meditate on Psalm 23 as the music gently plays.",
  "💡 Tip: take a deep breath and entrust your studies to the Lord.",
  "🎹 Worshiping with every note, even in the silence of your room.",
  "🌙 A calm night, filled with the presence of God.",
  "💬 Share your favorite Bible verse with the chat community.",
  "☕ A cup of tea, soft music, and gratitude to God.",
  "🎵 Every beat is an opportunity to worship.",
  "🌸 Jesus calms our hearts during study and work times.",
  "💭 Reflect on God's goodness while the lofi vibes play.",
  "✝️ Let the music guide your prayers and thoughts.",
  "📚 Studying with God’s presence makes everything easier.",
  "✨ Focus, relax, and worship in every moment.",
  "🎧 Headphones on, soul lifted, God first.",
  "🙏 Take a pause and thank God for this day.",
  "🎶 Instrumentals that inspire reflection and prayer.",
  "💡 God’s peace surrounds you as you study and rest.",
  "📖 Let the Word of God guide your thoughts today.",
];
async function sendMessageToChat(text) {
  if (!liveChatId) return;
  try {
    await youtube.liveChatMessages.insert({
      part: "snippet",
      requestBody: {
        snippet: {
          liveChatId,
          type: "textMessageEvent",
          textMessageDetails: { messageText: text },
        },
      },
    });
    console.log("Mensagem enviada:", text);
  } catch (err) {
    console.error("Erro ao enviar mensagem:", err.message);
  }
}
function startAutoMessages() {
  if (autoMsgInterval) clearInterval(autoMsgInterval);
  autoMsgInterval = setInterval(async () => {
    const now = Date.now();
    const diff = now - lastUserMessageTime;
    if (diff > 120 * 60 * 1000) {
      console.log(
        "Sem mensagens de usuário por 2hs. Pausando envio por 30 min."
      );
      clearInterval(autoMsgInterval);
      setTimeout(startAutoMessages, 30 * 60 * 1000);
      return;
    }
    const msg = messages[Math.floor(Math.random() * messages.length)];
    await sendMessageToChat(msg);
  }, 15 * 60 * 1000);
}
async function ensureLiveChatId() {
  if (liveChatId) return;
  try {
    const liveRes = await youtube.liveBroadcasts.list({
      part: "snippet",
      broadcastStatus: "active",
      broadcastType: "all",
    });
    if (liveRes.data.items.length > 0) {
      liveChatId = liveRes.data.items[0].snippet.liveChatId;
      console.log("Live chat ativo encontrado:", liveChatId);
    }
  } catch (err) {
    console.error("Erro ao buscar liveChatId:", err.message);
  }
}

// -----------------------
// FFmpeg Start
// -----------------------
// -----------------------
// FFmpeg Start - Versão Corrigida
// -----------------------
function startFFmpegOnce(params) {
  // 1. Armazena os parâmetros antes de iniciar (para uso no reinício)
  lastStreamParams = params; 

  const {
    baseVideo,
    audioFile,
    rtmpUrl,
    trackText,
    showCTA,
    ctaText,
    trackSeconds,
    ctaSeconds,
  } = params;

  // Evita iniciar um processo se um já estiver rodando
  if (ffmpegProc) {
    console.warn("FFmpeg já está rodando. Ignorando nova inicialização.");
    return;
  }
  
  const filter = buildFilterComplex({
    trackText,
    showCTA,
    ctaText,
    trackSeconds,
    ctaSeconds,
  });

  // Se for playlist .m3u → usa concat
  const audioArgs = audioFile.endsWith(".m3u")
    ? ["-f", "concat", "-safe", "0", "-i", audioFile]
    : ["-stream_loop", "-1", "-re", "-i", audioFile];

  const args = [
    "-stream_loop", "-1", "-re", "-i", baseVideo,
    ...audioArgs,
    "-filter_complex", filter,
    "-map", "[vout]", "-map", "[aud]",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-b:v", "3000k",
    "-maxrate", "3000k",
    "-bufsize", "6000k",
    "-g", "60",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "160k",
    "-ar", "44100",
    "-ac", "2",
    "-f", "flv", rtmpUrl,
  ];

  console.log("Iniciando FFmpeg...");
  console.log("FILTER_COMPLEX:\n", filter);
  ffmpegProc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });

  ffmpegProc.stderr.on("data", (d) => process.stdout.write(d.toString()));
  
  // 2. Lógica de monitoramento e reinício do FFmpeg
  ffmpegProc.on("close", (code) => {
    console.log("FFmpeg finalizado com código:", code);
    
    // O código de saída 0 ou null (geralmente SIGINT/SIGTERM) são considerados encerramentos esperados.
    // Qualquer outro código (ex: 1, 255) ou falta de código é uma falha inesperada.
    if (code !== 0 && code !== null) { 
      console.error(
        `FFmpeg falhou (Código: ${code}). Tentando REINICIAR em ${RESTART_DELAY_MS / 1000} segundos...`
      );
      
      // Usa setTimeout para atrasar a reinicialização e dar tempo ao sistema/rede para se recuperar
      setTimeout(() => {
        if (lastStreamParams) {
          console.log("Reiniciando FFmpeg com os últimos parâmetros...");
          // Chama a própria função para reiniciar o streaming
          startFFmpegOnce(lastStreamParams); 
        } else {
          console.error("Não há parâmetros armazenados para reiniciar o streaming. Abortando.");
        }
      }, RESTART_DELAY_MS);
    } else {
        console.log("FFmpeg finalizado de forma esperada/manual. Não será reiniciado.");
    }
    
    // Limpa o estado da variável ffmpegProc APÓS a decisão de reinício
    ffmpegProc = null; 
  });
}


// -----------------------
// Rotas
// -----------------------
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    ffmpegRunning: !!ffmpegProc,
    baseVideoExists: fs.existsSync(BASE_VIDEO),
    audioFileExists: fs.existsSync(AUDIO_FILE),
    youtubeAuth: !!oauth2Client.credentials.access_token,
  });
});

app.post("/stream/start", async (req, res) => {
  if (ffmpegProc) return res.json({ ok: true, msg: "Já está transmitindo" });

  if (!RTMP_URL)
    return res.status(400).json({ ok: false, msg: "RTMP_URL ausente" });
  if (!fs.existsSync(BASE_VIDEO))
    return res
      .status(400)
      .json({ ok: false, msg: `BASE_VIDEO não encontrado: ${BASE_VIDEO}` });
  if (!fs.existsSync(AUDIO_FILE))
    return res
      .status(400)
      .json({ ok: false, msg: `AUDIO_FILE não encontrado: ${AUDIO_FILE}` });

  const streamParams = {
    baseVideo: BASE_VIDEO,
    audioFile: AUDIO_FILE,
    rtmpUrl: RTMP_URL,
    trackText: (req.body?.trackText || OVERLAY_TRACK_TEMPLATE)
      .replace("{title}", req.body?.title || TRACK_TITLE)
      .replace("{artist}", req.body?.artist || TRACK_ARTIST),
    showCTA: req.body?.showCta ?? SHOW_CTA,
    ctaText: (req.body?.ctaText || CTA_TEXT_TEMPLATE)
      .replace("{live_title}", LIVE_TITLE)
      .replace("{channel_name}", CHANNEL_NAME),
    trackSeconds: TRACK_OVERLAY_SECONDS,
    ctaSeconds: CTA_SECONDS,
  };
  
  // Chama com os parâmetros criados. A função armazena e inicia.
  startFFmpegOnce(streamParams);

  await ensureLiveChatId();
  startAutoMessages();

  res.json({ ok: true, msg: "Streaming iniciado" });
});

app.post("/stream/stop", (req, res) => {
  if (!ffmpegProc)
    return res.status(400).json({ ok: false, msg: "Não está transmitindo" });
  ffmpegProc.kill("SIGINT");
  ffmpegProc = null;
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
});
