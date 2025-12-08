import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import readline from 'readline';

// --- CONFIGURAÇÃO DE CAMINHOS (ESM Fix) ---
// Em ES Modules, __dirname não existe, então criamos manualmente:
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOKENS_PATH = path.join(__dirname, 'tokens.json');

// --- VARIÁVEIS DE AMBIENTE ---
// Substitua pelas suas strings ou use process.env se estiver usando dotenv
const CLIENT_ID = process.env.YT_CLIENT_ID || 'SEU_CLIENT_ID';
const CLIENT_SECRET = process.env.YT_CLIENT_SECRET_KEY || 'SEU_CLIENT_SECRET';
const REDIRECT_URI = process.env.YT_REDIRECT_URI || 'http://localhost:3000/oauth2callback'; // Ou o link do playground se usou ele

// --- CONFIGURAÇÃO OAUTH2 ---
const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
const SCOPES = ['https://www.googleapis.com/auth/youtube.force-ssl'];

// --- GERENCIAMENTO DE TOKENS ---

// Evento para salvar refresh token automaticamente quando renovado
oauth2Client.on('tokens', (tokens) => {
  if (tokens.refresh_token || tokens.access_token) {
    let current = {};
    if (fs.existsSync(TOKENS_PATH)) {
      current = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
    }
    const newTokens = { ...current, ...tokens };
    fs.writeFileSync(TOKENS_PATH, JSON.stringify(newTokens, null, 2));
    console.log('🔄 Tokens atualizados e salvos em tokens.json');
  }
});

// Função para gerar novos tokens via terminal (Primeira vez)
function getNewToken() {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', // Crucial para receber refresh_token
    scope: SCOPES,
    prompt: 'consent', // Força gerar refresh_token novo
  });

  console.log('\n⚠️  AUTENTICAÇÃO NECESSÁRIA ⚠️');
  console.log('Autorize este app visitando a URL abaixo:');
  console.log(authUrl);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('\nCole o código da URL de retorno aqui: ', (code) => {
    rl.close();
    oauth2Client.getToken(code, (err, token) => {
      if (err) return console.error('❌ Erro ao recuperar token:', err);
      
      oauth2Client.setCredentials(token);
      fs.writeFileSync(TOKENS_PATH, JSON.stringify(token, null, 2));
      console.log('✅ Token gerado e salvo com sucesso!');
      
      // Inicia o bot após logar
      iniciarBot();
    });
  });
}

// Inicializador de Autenticação
async function autenticar() {
  if (fs.existsSync(TOKENS_PATH)) {
    const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
    
    // Verificação de segurança
    if (!tokens.refresh_token) {
      console.log('⚠️ Token existente sem refresh_token. Reautenticando...');
      getNewToken();
    } else {
      oauth2Client.setCredentials(tokens);
      console.log('✅ Autenticado via tokens.json');
      iniciarBot();
    }
  } else {
    getNewToken();
  }
}

// --- LÓGICA DO BOT ---

let liveChatId = null;
let autoMsgInterval = null;
let lastUserMessageTime = Date.now(); // Resetar isso se você tiver um listener de chat

const messages = [
  "🎶 Hi guys, welcome to the live! Where are you watching from?",
  "🙏 Lofi Worship 24/7 — relax, study and pray with us.",
  "✨ Don't forget to like 👍 the stream, it helps a lot!",
  "💬 What's your favorite verse or quote for today?",
  // ... coloque o resto das suas mensagens aqui ...
];

async function ensureLiveChatId() {
  // Se já tem ID, retorna
  if (liveChatId) return;

  try {
    console.log('🔍 Buscando live ativa no seu canal...');
    const liveRes = await youtube.liveBroadcasts.list({
      part: ['snippet'], // Array no ESM é mais seguro passar assim
      broadcastStatus: 'active',
      broadcastType: 'all',
      mine: true, // Garante que é no SEU canal
    });

    if (liveRes.data.items && liveRes.data.items.length > 0) {
      liveChatId = liveRes.data.items[0].snippet.liveChatId;
      console.log(`📡 Live encontrada! Chat ID: ${liveChatId}`);
    } else {
      console.log('🚫 Nenhuma live ativa encontrada no momento.');
    }
  } catch (err) {
    console.error('❌ Erro ao buscar liveChatId:', err.message);
  }
}

async function sendMessageToChat(text) {
  if (!liveChatId) {
    await ensureLiveChatId(); // Tenta buscar de novo se perdeu
    if (!liveChatId) return;
  }

  try {
    await youtube.liveChatMessages.insert({
      part: ['snippet'],
      requestBody: {
        snippet: {
          liveChatId,
          type: 'textMessageEvent',
          textMessageDetails: { messageText: text },
        },
      },
    });
    console.log(`📨 Mensagem enviada: "${text}"`);
  } catch (err) {
    console.error('❌ Erro ao enviar mensagem:', err.message);
    // Se erro for 404 (chat não existe mais), reseta o ID
    if (err.code === 404) liveChatId = null;
  }
}

function iniciarBot() {
  console.log('🚀 Bot iniciado!');
  
  // Tenta pegar o ID da live logo de cara
  ensureLiveChatId();

  if (autoMsgInterval) clearInterval(autoMsgInterval);
  
  // Intervalo de 12 minutos (exemplo)
  autoMsgInterval = setInterval(async () => {
    // Lógica simples de pausa se quiser implementar inatividade
    // if (Date.now() - lastUserMessageTime > ... ) return;

    if (!liveChatId) await ensureLiveChatId();
    
    if (liveChatId) {
      const msg = messages[Math.floor(Math.random() * messages.length)];
      await sendMessageToChat(msg);
    }
  }, 12 * 60 * 1000); // 12 minutos
}

// --- BOOTSTRAP ---
// Inicia o processo
autenticar();