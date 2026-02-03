/**
 * Script para generar token.json inicial mediante OAuth2
 * Ejecutar: npx ts-node src/scripts/generate-token.ts
 */
import { google } from 'googleapis';
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { getGoogleConfig } from '../config/google.config';

interface CredentialsData {
  installed?: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
  web?: {
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
  };
  client_id?: string;
  client_secret?: string;
  redirect_uris?: string[];
  redirect_uri?: string;
}

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/spreadsheets'
];

async function getNewToken(oAuth2Client: any, tokenPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent' // Forzar consentimiento para obtener refresh_token
    });

    console.log('\n🔐 Autorización requerida');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('1. Abre la siguiente URL en tu navegador:');
    console.log('\n' + authUrl + '\n');
    console.log('2. Autoriza la aplicación');
    console.log('3. Copia el código de autorización de la URL de respuesta');
    console.log('   (el parámetro "code" después de "?code=")');
    console.log('═══════════════════════════════════════════════════════════\n');

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('Pega el código de autorización aquí: ', async (code: string) => {
      rl.close();

      try {
        const codeTrimmed = code.trim();
        const { tokens } = await oAuth2Client.getToken(codeTrimmed);
        
        oAuth2Client.setCredentials(tokens);

        // Guardar token en archivo
        await fs.writeFile(tokenPath, JSON.stringify(tokens, null, 2), { encoding: 'utf-8' });
        
        console.log('\n✅ Token guardado exitosamente en:', tokenPath);
        console.log('✅ Puedes usar el servicio ahora.\n');
        
        resolve();
      } catch (error: any) {
        console.error('\n❌ Error obteniendo token:', error.message);
        reject(error);
      }
    });
  });
}

async function main() {
  try {
    const config = getGoogleConfig();
    const credentialsPath = config.CREDENTIALS_PATH;
    const tokenPath = config.TOKEN_PATH;

    console.log('📋 Configuración:');
    console.log('   Credenciales:', credentialsPath);
    console.log('   Token:', tokenPath);
    console.log('');

    // Verificar que existe credentials.json
    try {
      await fs.access(credentialsPath);
    } catch {
      throw new Error(`No se encontró el archivo de credenciales en: ${credentialsPath}`);
    }

    // Leer credenciales
    const credentialsContent = await fs.readFile(credentialsPath, { encoding: 'utf-8' });
    const credentials = JSON.parse(credentialsContent) as CredentialsData;

    let client_secret: string;
    let client_id: string;
    let redirect_uris: string[];

    if (credentials.installed) {
      ({ client_secret, client_id, redirect_uris } = credentials.installed);
    } else if (credentials.web) {
      ({ client_secret, client_id, redirect_uris } = credentials.web);
    } else {
      client_secret = credentials.client_secret!;
      client_id = credentials.client_id!;
      redirect_uris = credentials.redirect_uris || (credentials.redirect_uri ? [credentials.redirect_uri] : ['http://localhost']);
    }

    if (!client_id || !client_secret) {
      throw new Error('client_id o client_secret no encontrados en credentials.json');
    }

    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );

    // Verificar si ya existe token.json
    try {
      await fs.access(tokenPath);
      const tokenContent = await fs.readFile(tokenPath, { encoding: 'utf-8' });
      const token = JSON.parse(tokenContent);
      
      if (token.refresh_token) {
        console.log('⚠️  Ya existe un token.json con refresh_token.');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        rl.question('¿Deseas sobrescribirlo? (s/N): ', async (answer: string) => {
          rl.close();
          
          if (answer.toLowerCase() === 's' || answer.toLowerCase() === 'y') {
            await getNewToken(oAuth2Client, tokenPath);
          } else {
            console.log('Operación cancelada.');
            process.exit(0);
          }
        });
      } else {
        // No hay refresh_token, generar uno nuevo
        await getNewToken(oAuth2Client, tokenPath);
      }
    } catch {
      // No existe token.json, generar uno nuevo
      await getNewToken(oAuth2Client, tokenPath);
    }

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
