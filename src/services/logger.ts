import winston from 'winston';
import path from 'path';
import fs from 'fs';

const logDir = process.env.LOG_PATH || './logs';

// Crear directorio de logs si no existe
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Función para obtener timestamp en zona horaria Argentina
const getArgentinaTimestamp = () => {
  const now = new Date();
  // Convertir a hora de Argentina (America/Buenos_Aires)
  // Formato: YYYY-MM-DD HH:mm:ss
  const dateStr = now.toLocaleString('en-CA', { 
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  // toLocaleString con 'en-CA' da formato: YYYY-MM-DD, HH:mm:ss
  return dateStr.replace(', ', ' ');
};

// Formato para consola (legible para humanos, sin colores en producción)
const consoleFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
  const ts = timestamp || getArgentinaTimestamp();
  const metaStr = Object.keys(metadata).length ? JSON.stringify(metadata, null, 2) : '';
  return `[${ts}] ${level.toUpperCase().padEnd(5)} ${message}${metaStr ? ' ' + metaStr : ''}`;
});

// Nivel de log configurable (por defecto: info)
const logLevel = process.env.LOG_LEVEL || 'info';
const isProduction = process.env.NODE_ENV === 'production';

const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'caradvice-backend' },
  transports: [
    // Archivo de errores (solo errores)
    new winston.transports.File({ 
      filename: path.join(logDir, 'error.log'), 
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5
    }),
    // Archivo de sync (eventos de sincronización)
    new winston.transports.File({ 
      filename: path.join(logDir, 'sync.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 5
    })
  ]
});

// Transport de consola SIEMPRE activo (visible en pm2 logs)
logger.add(new winston.transports.Console({
  format: winston.format.combine(
    // Sin colores en producción (mejor legibilidad en pm2 logs)
    isProduction 
      ? winston.format.combine(
          winston.format.timestamp({ format: () => getArgentinaTimestamp() }),
          consoleFormat
        )
      : winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp({ format: () => getArgentinaTimestamp() }),
          consoleFormat
        )
  ),
  level: logLevel
}));

export default logger;

