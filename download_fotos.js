const fs = require('fs');
const http = require('http');
const url = require('url');
const { google } = require('googleapis');
const axios = require('axios');
const path = require('path');

// Configurações
const SCOPES = ['https://www.googleapis.com/auth/photoslibrary'];
const CREDENTIALS_PATH = 'credentials.json';
const TOKEN_PATH = 'token.json';
const DOWNLOAD_DIR = path.join(__dirname, 'fotos_google');

// Função principal
async function main() {
    console.log("Iniciando conexão com Google Fotos...");
    
    // 1. Ler as credenciais
    let credentials;
    try {
        const credentialsFile = fs.readdirSync(__dirname).find(f => f.startsWith('client_secret_') && f.endsWith('.json'));
        if (credentialsFile) {
            fs.renameSync(credentialsFile, CREDENTIALS_PATH);
            console.log(`Arquivo ${credentialsFile} renomeado para credentials.json`);
        }
        const content = fs.readFileSync(CREDENTIALS_PATH);
        credentials = JSON.parse(content);
    } catch (err) {
        console.error('Erro ao ler o arquivo credentials.json. Certifique-se de que ele está na pasta:', err.message);
        return;
    }

    const { client_secret, client_id } = credentials.installed || credentials.web;
    const redirectUri = 'http://localhost:8080';
    
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

    // Forçar novo login deletando o token
    if (fs.existsSync(TOKEN_PATH)) {
        fs.unlinkSync(TOKEN_PATH);
        console.log("Token antigo apagado para forçar novo login.");
    }

    console.log("Vamos fazer login.");
    await fazerLogin(oAuth2Client);
}

// Fazer login e obter código
async function fazerLogin(oAuth2Client) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
    });

    console.log('\n=============================================================');
    console.log('CLIQUE NO LINK ABAIXO PARA AUTORIZAR O ACESSO ÀS SUAS FOTOS:');
    console.log(authUrl);
    console.log('=============================================================\n');

    // Cria um servidor temporário para receber o código de volta
    const server = http.createServer(async (req, res) => {
        try {
            const qs = new url.URL(req.url, 'http://localhost:8080').searchParams;
            const code = qs.get('code');
            
            if (code) {
                res.end('Autenticacao concluida! Pode fechar esta aba e voltar para o terminal.');
                server.close();
                
                const { tokens } = await oAuth2Client.getToken(code);
                oAuth2Client.setCredentials(tokens);
                fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
                console.log('Login concluído com sucesso!');
                
                await baixarFotos(oAuth2Client);
            } else {
                res.end('Aguardando autenticacao...');
            }
        } catch (e) {
            res.end('Erro: ' + e.message);
        }
    }).listen(8080, () => {
        console.log('Aguardando você fazer login no navegador...');
    });
}

// Baixar as fotos recentes
async function baixarFotos(auth) {
    console.log('\nBuscando suas fotos mais recentes...');
    const accessToken = auth.credentials.access_token;
    
    try {
        // A API de fotos não está no pacote googleapis padrão, então usamos axios com o token
        const response = await axios.get('https://photoslibrary.googleapis.com/v1/mediaItems?pageSize=10', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const fotos = response.data.mediaItems;
        if (!fotos || fotos.length === 0) {
            console.log('Nenhuma foto encontrada.');
            return;
        }

        // Cria a pasta se não existir
        if (!fs.existsSync(DOWNLOAD_DIR)){
            fs.mkdirSync(DOWNLOAD_DIR);
        }

        console.log(`Encontradas ${fotos.length} fotos. Iniciando download...`);

        let count = 1;
        for (const foto of fotos) {
            // Apenas imagens
            if (foto.mimeType.startsWith('image/')) {
                const urlDownload = `${foto.baseUrl}=d`; // =d faz o download original
                const filePath = path.join(DOWNLOAD_DIR, `foto_${count}.jpg`);
                
                const writer = fs.createWriteStream(filePath);
                const resDownload = await axios({
                    url: urlDownload,
                    method: 'GET',
                    responseType: 'stream'
                });
                
                resDownload.data.pipe(writer);
                console.log(`✅ Foto ${count} salva em: fotos_google/foto_${count}.jpg`);
                count++;
            }
        }
        
        console.log('\n🎉 Todas as fotos foram baixadas na pasta "fotos_google"!');
    } catch (error) {
        console.error('Erro ao buscar as fotos:', error.response ? error.response.data : error.message);
    }
}

main();
