import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

// --- CONFIGURAÇÃO (Ajustada para sua estrutura REAL /srv/lofi) ---
const PASTA_ORIGEM = '/srv/lofi/audios_raw'; 
const PASTA_DESTINO = '/srv/lofi/musics'; 
// ---------------------------------------------------------------

// Garante que a pasta destino existe
if (!fs.existsSync(PASTA_DESTINO)) {
    fs.mkdirSync(PASTA_DESTINO, { recursive: true });
}

// Verifica se a origem existe antes de começar
if (!fs.existsSync(PASTA_ORIGEM)) {
    console.error(`❌ Erro: A pasta de origem não existe: ${PASTA_ORIGEM}`);
    process.exit(1);
}

const arquivos = fs.readdirSync(PASTA_ORIGEM);
console.log(`📂 Lendo arquivos de: ${PASTA_ORIGEM}`);

arquivos.forEach((arquivo, index) => {
  // Ignora arquivos que não sejam de áudio ou arquivos de sistema
  if (!arquivo.match(/\.(mp3|m4a|wav|flac)$/i)) return;

  const input = path.join(PASTA_ORIGEM, arquivo);
  
  // Limpa o nome do arquivo (remove espaços e caracteres especiais para evitar bugs no Linux)
  const nomeLimpo = path.parse(arquivo).name.replace(/[^a-zA-Z0-9-_]/g, '_');
  const output = path.join(PASTA_DESTINO, nomeLimpo + '.mp3');

  console.log(`[${index + 1}/${arquivos.length}] 🔨 Convertendo: ${arquivo} -> ${nomeLimpo}.mp3`);

  const result = spawnSync('ffmpeg', [
    '-y',               // Sobrescreve se já existir
    '-i', input,        
    '-ar', '44100',     // Padrão 44.1kHz
    '-ac', '2',         // Stereo
    '-c:a', 'libmp3lame', 
    '-b:a', '192k',     // Bitrate fixo (importante para o concat)
    output              
  ], { stdio: 'ignore' });

  if (result.error || result.status !== 0) {
    console.error(`❌ Erro ao converter: ${arquivo}`);
  }
});

console.log('\n✅ Conversão concluída! Músicas prontas em: ' + PASTA_DESTINO);
