# 🔧 Correcciones para el archivo .env de Producción

## ❌ Problemas Encontrados

1. **URLs incorrectas**: Tienes `http://tu-subdominio.duckdns.org` en lugar de `https://api-caradvice.duckdns.org`
2. **Variable incorrecta**: Usas `ASOFIX_API_ENDPOINT` pero el código espera `ASOFIX_API_ENDPOINT` (está bien, pero falta `ASOFIX_API_URL` que no se usa)
3. **Variable de cron**: Usas `SYNC_CRON_SCHEDULE` pero el código espera `CRON_SCHEDULE`

## ✅ Archivo .env Corregido

Reemplaza tu archivo `.env` en el servidor con este contenido:

```env
NODE_ENV=production
PORT=4000

# Base de Datos
DB_HOST=localhost
DB_PORT=3306
DB_USER=caradvice_user
DB_PASSWORD=CarAdvice#2025!
DB_NAME=caradvice_db

# API Externa - ASOFIX
ASOFIX_API_KEY=QIXMu940jbMM1KFjPK2ev5t5Wt+cbO0NX5MqwnM2RzAKgeIFj//WtQ==
ASOFIX_API_ENDPOINT=https://app.asofix.com/api/catalogs/web

# Rutas de Medios
MEDIA_ROOT=/opt/caradvice-media
IMAGES_PATH=/opt/caradvice-media/images
VIDEOS_PATH=/opt/caradvice-media/videos
UPLOAD_PATH=/opt/caradvice-media/images/autos

# URLs Públicas (CORREGIDAS)
API_BASE_URL=https://api-caradvice.duckdns.org
MEDIA_BASE_URL=https://api-caradvice.duckdns.org/media

# Logging
LOG_PATH=/opt/caradvice-api/backend/logs
LOG_LEVEL=info

# Sincronización Automática
ENABLE_AUTO_SYNC=true
CRON_SCHEDULE=0 4 * * *
TZ=America/Argentina/Buenos_Aires

# Filtros (configurados en filters.ts, pero puedes usar estas variables)
BLOCKED_BRANCH_OFFICES=Dakota
MIN_PRICE=1
BLOCKED_STATUSES=reservado

# Seguridad
SYNC_TOKEN=ca2026

# CORS (actualizar con tu dominio de Vercel)
CORS_ORIGINS=https://caradvice-ui.vercel.app,https://www.caradvice.com.ar

# Cache
CACHE_MAX_AGE=604800
```

## 🔑 Cambios Principales

1. **API_BASE_URL**: `http://tu-subdominio.duckdns.org` → `https://api-caradvice.duckdns.org`
2. **MEDIA_BASE_URL**: `http://tu-subdominio.duckdns.org/media` → `https://api-caradvice.duckdns.org/media`
3. **SYNC_CRON_SCHEDULE** → **CRON_SCHEDULE**
4. **CORS_ORIGINS**: Cambiado de `*` a dominios específicos (más seguro)

## 📝 Nota sobre CORS

Si tu frontend está en Vercel, asegúrate de incluir todos los dominios posibles:
- `https://caradvice-ui.vercel.app`
- `https://www.caradvice.com.ar` (si tienes dominio propio)
- `https://caradvice.com.ar` (sin www)

Si necesitas permitir todos los orígenes temporalmente, puedes usar `*`, pero no es recomendado para producción.


