import fs from 'fs';
import path from 'path';

// --- CONFIGURAÇÃO ---
const PASTA_MUSICAS_PRONTAS = '/srv/lofi/musics'; 
// Vamos salvar a playlist na raiz do app para ficar fácil de achar
const ARQUIVO_PLAYLIST = '/srv/lofi/app/playlist.m3u'; 
// --------------------

if (!fs.existsSync(PASTA_MUSICAS_PRONTAS)) {
    console.error("❌ Erro: A pasta de músicas prontas não existe. Rode o padronizar.js primeiro.");
    process.exit(1);
}

const arquivos = fs.readdirSync(PASTA_MUSICAS_PRONTAS);

const linhas = arquivos
  .filter(file => file.endsWith('.mp3')) 
  .map(file => {
    // Resolve o caminho absoluto
    const caminhoAbsoluto = path.join(PASTA_MUSICAS_PRONTAS, file);
    return `file '${caminhoAbsoluto}'`;
  });

// Embaralhar (Shuffle)
for (let i = linhas.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [linhas[i], linhas[j]] = [linhas[j], linhas[i]];
}

fs.writeFileSync(ARQUIVO_PLAYLIST, linhas.join('\n'));

console.log(`📜 Playlist gerada em: ${ARQUIVO_PLAYLIST}`);
console.log(`🎵 Total de faixas: ${linhas.length}`);
