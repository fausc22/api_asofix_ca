# 🔐 Variables de Entorno - Backend CarAdvice

Este documento lista todas las variables de entorno necesarias para el backend en producción.

## 📋 Variables Requeridas

### Entorno
```env
NODE_ENV=production
PORT=4000
```

### Base de Datos MySQL
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=caradvice_user
DB_PASSWORD=tu_password_seguro_aqui
DB_NAME=caradvice_db
```

### API Externa - ASOFIX
```env
ASOFIX_API_KEY=tu_api_key_de_asofix_aqui
ASOFIX_API_URL=https://api.asofix.com
```

### Rutas de Medios
```env
MEDIA_ROOT=/opt/caradvice-media
IMAGES_PATH=/opt/caradvice-media/images
VIDEOS_PATH=/opt/caradvice-media/videos
UPLOAD_PATH=/opt/caradvice-media/images/autos
```

### URLs Públicas
```env
API_BASE_URL=http://tu-subdominio.duckdns.org
MEDIA_BASE_URL=http://tu-subdominio.duckdns.org/media
```

### Logging
```env
LOG_PATH=/opt/caradvice-api/backend/logs
LOG_LEVEL=info
```

### Sincronización Automática
```env
ENABLE_AUTO_SYNC=true
CRON_SCHEDULE=0 */6 * * *
```

### Seguridad
```env
SYNC_TOKEN=
```

### CORS
```env
CORS_ORIGINS=*
```

### Cache
```env
CACHE_MAX_AGE=604800
```

## 📝 Ejemplo Completo de .env

```env
# ============================================
# Configuración del Entorno - CarAdvice Backend
# ============================================

# Entorno de ejecución
NODE_ENV=production

# Puerto del servidor
PORT=4000

# ============================================
# Base de Datos MySQL
# ============================================
DB_HOST=localhost
DB_PORT=3306
DB_USER=caradvice_user
DB_PASSWORD=tu_password_seguro_aqui
DB_NAME=caradvice_db

# ============================================
# API Externa - ASOFIX
# ============================================
ASOFIX_API_KEY=tu_api_key_de_asofix_aqui
ASOFIX_API_URL=https://api.asofix.com

# ============================================
# Rutas de Medios (Archivos)
# ============================================
MEDIA_ROOT=/opt/caradvice-media
IMAGES_PATH=/opt/caradvice-media/images
VIDEOS_PATH=/opt/caradvice-media/videos
UPLOAD_PATH=/opt/caradvice-media/images/autos

# ============================================
# URLs Públicas
# ============================================
API_BASE_URL=http://tu-subdominio.duckdns.org
MEDIA_BASE_URL=http://tu-subdominio.duckdns.org/media

# ============================================
# Logging
# ============================================
LOG_PATH=/opt/caradvice-api/backend/logs
LOG_LEVEL=info

# ============================================
# Sincronización Automática
# ============================================
ENABLE_AUTO_SYNC=true
CRON_SCHEDULE=0 */6 * * *

# ============================================
# Seguridad
# ============================================
SYNC_TOKEN=

# ============================================
# CORS
# ============================================
CORS_ORIGINS=*

# ============================================
# Cache
# ============================================
CACHE_MAX_AGE=604800
```

## ⚠️ Notas Importantes

1. **Nunca** subir el archivo `.env` al repositorio
2. Usar contraseñas seguras y únicas
3. El archivo `.env` debe tener permisos `600`: `chmod 600 .env`
4. Reemplazar todos los valores de ejemplo con valores reales
5. `CORS_ORIGINS=*` permite todos los orígenes. Para producción, especificar dominios exactos:
   ```env
   CORS_ORIGINS=https://caradvice.com.ar,https://www.caradvice.com.ar
   ```

## 🔄 Valores por Defecto

Si una variable no está definida, el sistema usará estos valores por defecto:

- `PORT`: 4000
- `NODE_ENV`: development
- `DB_HOST`: localhost
- `DB_PORT`: 3306
- `DB_USER`: root
- `DB_PASSWORD`: (vacío)
- `DB_NAME`: caradvice
- `MEDIA_ROOT`: /opt/caradvice-media
- `IMAGES_PATH`: /opt/caradvice-media/images
- `VIDEOS_PATH`: /opt/caradvice-media/videos
- `LOG_PATH`: ./logs
- `LOG_LEVEL`: info
- `ENABLE_AUTO_SYNC`: true
- `CACHE_MAX_AGE`: 604800 (7 días)
- `CORS_ORIGINS`: *

