# 🚀 Guía de Despliegue - Backend CarAdvice

Esta guía detalla el proceso completo para desplegar el backend de CarAdvice en un VPS con Ubuntu 20.04 LTS.

## 📋 Tabla de Contenidos

1. [Preparación del Backend](#1-preparación-del-backend)
2. [Provisionamiento del VPS](#2-provisionamiento-del-vps)
3. [Instalación y Configuración de MySQL](#3-instalación-y-configuración-de-mysql)
4. [Estructura de Carpetas](#4-estructura-de-carpetas)
5. [Despliegue del Backend](#5-despliegue-del-backend)
6. [Configuración de PM2](#6-configuración-de-pm2)
7. [Configuración de DuckDNS](#7-configuración-de-duckdns)
8. [Configuración de Nginx (Opcional)](#8-configuración-de-nginx-opcional)
9. [Verificación y Pruebas](#9-verificación-y-pruebas)
10. [Mantenimiento](#10-mantenimiento)

---

## 1️⃣ Preparación del Backend

### Archivos a Subir por FTP

**IMPORTANTE:** NO subir las siguientes carpetas/archivos:
- `node_modules/`
- `uploads/`
- `dist/` (se generará en el servidor)
- `.env` (se creará en el servidor)
- `logs/` (se creará automáticamente)

**Estructura de archivos a subir:**

```
backend/
├── src/
│   ├── config/
│   ├── controllers/
│   ├── jobs/
│   ├── routes/
│   ├── scripts/
│   └── services/
├── database/
│   └── final_schema.sql
├── ecosystem.config.js
├── package.json
├── tsconfig.json
└── .gitignore
```

### Cambios Realizados para Producción

✅ **Variables de entorno configurables:**
- `PORT` - Puerto del servidor (default: 4000)
- `NODE_ENV=production`
- `MEDIA_ROOT` - Ruta base de medios (`/opt/caradvice-media`)
- `IMAGES_PATH` - Ruta de imágenes (`/opt/caradvice-media/images`)
- `VIDEOS_PATH` - Ruta de videos (`/opt/caradvice-media/videos`)
- `CACHE_MAX_AGE` - Tiempo de cache en segundos (default: 604800 = 7 días)

✅ **CORS configurado:**
- Variable `CORS_ORIGINS` para orígenes permitidos
- Soporta múltiples orígenes separados por coma

✅ **Cache implementado:**
- Archivos estáticos: Cache largo (7-30 días)
- Endpoints GET de vehículos: Cache de 5 minutos
- Endpoints de sincronización: Sin cache

✅ **Servicio de medios:**
- Endpoint `/api/image` (compatibilidad con frontend)
- Endpoint `/media/images/*` (nuevo)
- Endpoint `/media/videos/*` (nuevo)

---

## 2️⃣ Provisionamiento del VPS

### Actualizar Sistema

```bash
sudo apt update
sudo apt upgrade -y
```

### Instalar Node.js LTS

```bash
# Instalar Node.js 20.x LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verificar instalación
node --version
npm --version
```

### Instalar PM2

```bash
sudo npm install -g pm2

# Verificar instalación
pm2 --version
```

### Instalar MySQL Server

```bash
sudo apt install -y mysql-server

# Verificar instalación
mysql --version
```

### Configurar Firewall (UFW)

```bash
# Habilitar UFW
sudo ufw enable

# Permitir SSH (IMPORTANTE: hacerlo primero)
sudo ufw allow 22/tcp

# Permitir puerto de la API
sudo ufw allow 4000/tcp

# Permitir HTTP (para Nginx si se usa)
sudo ufw allow 80/tcp

# Permitir HTTPS (para futuro)
sudo ufw allow 443/tcp

# Verificar estado
sudo ufw status
```

---

## 3️⃣ Instalación y Configuración de MySQL

### Ejecutar mysql_secure_installation

```bash
sudo mysql_secure_installation
```

Seguir las instrucciones:
- Establecer contraseña para root
- Remover usuarios anónimos: **Y**
- Deshabilitar login remoto de root: **Y**
- Remover base de datos de test: **Y**
- Recargar privilegios: **Y**

### Crear Base de Datos y Usuario

```bash
sudo mysql -u root -p
```

Ejecutar en MySQL:

```sql
-- Crear base de datos
CREATE DATABASE caradvice_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Crear usuario dedicado
CREATE USER 'caradvice_user'@'localhost' IDENTIFIED BY 'TU_PASSWORD_SEGURO_AQUI';

-- Otorgar permisos
GRANT ALL PRIVILEGES ON caradvice_db.* TO 'caradvice_user'@'localhost';

-- Aplicar cambios
FLUSH PRIVILEGES;

-- Verificar
SHOW DATABASES;
SELECT user, host FROM mysql.user WHERE user = 'caradvice_user';

-- Salir
EXIT;
```

### Importar Schema

```bash
# Desde el directorio del backend
cd /opt/caradvice-api/backend
sudo mysql -u caradvice_user -p caradvice_db < database/final_schema.sql
```

---

## 4️⃣ Estructura de Carpetas

### Crear Estructura en /opt

```bash
# Crear directorio base de la API
sudo mkdir -p /opt/caradvice-api/backend
sudo mkdir -p /opt/caradvice-api/backend/logs

# Crear directorio de medios
sudo mkdir -p /opt/caradvice-media/images/autos
sudo mkdir -p /opt/caradvice-media/images/brands
sudo mkdir -p /opt/caradvice-media/videos/autos

# Establecer permisos
sudo chown -R $USER:$USER /opt/caradvice-api
sudo chown -R $USER:$USER /opt/caradvice-media

# Permisos de escritura para la API
chmod -R 755 /opt/caradvice-api
chmod -R 755 /opt/caradvice-media
```

### Justificación de la Estructura

- **`/opt/caradvice-api/backend/`**: Código del backend, separado de otros servicios
- **`/opt/caradvice-media/`**: Medios persistentes, independiente del código
- **Separación de responsabilidades**: Facilita backups, actualizaciones y escalabilidad

---

## 5️⃣ Despliegue del Backend

### Subir Archivos por FTP

1. Conectar al servidor por FTP
2. Navegar a `/opt/caradvice-api/backend/`
3. Subir todos los archivos (excepto los excluidos)

### Instalar Dependencias

```bash
cd /opt/caradvice-api/backend
npm install --production
```

### Compilar TypeScript

```bash
npm run build
```

### Crear Archivo .env

```bash
cd /opt/caradvice-api/backend
nano .env
```

Contenido del `.env`:

```env
# Entorno
NODE_ENV=production
PORT=4000

# Base de Datos
DB_HOST=localhost
DB_PORT=3306
DB_USER=caradvice_user
DB_PASSWORD=TU_PASSWORD_SEGURO_AQUI
DB_NAME=caradvice_db

# API Externa - ASOFIX
ASOFIX_API_KEY=tu_api_key_de_asofix_aqui
ASOFIX_API_URL=https://api.asofix.com

# Rutas de Medios
MEDIA_ROOT=/opt/caradvice-media
IMAGES_PATH=/opt/caradvice-media/images
VIDEOS_PATH=/opt/caradvice-media/videos
UPLOAD_PATH=/opt/caradvice-media/images/autos

# URLs Públicas
API_BASE_URL=http://tu-subdominio.duckdns.org
MEDIA_BASE_URL=http://tu-subdominio.duckdns.org/media

# Logging
LOG_PATH=/opt/caradvice-api/backend/logs
LOG_LEVEL=info

# Sincronización Automática
ENABLE_AUTO_SYNC=true
CRON_SCHEDULE=0 */6 * * *

# Seguridad
SYNC_TOKEN=

# CORS
CORS_ORIGINS=*

# Cache
CACHE_MAX_AGE=604800
```

**Proteger el archivo .env:**

```bash
chmod 600 .env
```

---

## 6️⃣ Configuración de PM2

### Iniciar con PM2

```bash
cd /opt/caradvice-api/backend
pm2 start ecosystem.config.js
```

### Configurar PM2 para Inicio Automático

```bash
# Generar script de inicio
pm2 startup

# Seguir las instrucciones que aparecen (generalmente un comando sudo)

# Guardar configuración actual
pm2 save
```

### Comandos Útiles de PM2

```bash
# Ver estado
pm2 status

# Ver logs
pm2 logs caradvice-api

# Ver logs en tiempo real
pm2 logs caradvice-api --lines 50

# Reiniciar
pm2 restart caradvice-api

# Detener
pm2 stop caradvice-api

# Eliminar del PM2
pm2 delete caradvice-api

# Monitoreo
pm2 monit
```

### Verificar que el Servidor Está Corriendo

```bash
# Verificar proceso
pm2 status

# Verificar puerto
sudo netstat -tlnp | grep 4000

# Probar endpoint de salud
curl http://localhost:4000/health
```

---

## 7️⃣ Configuración de DuckDNS

### Crear Subdominio

1. Ir a https://www.duckdns.org/
2. Iniciar sesión o crear cuenta
3. Crear un nuevo subdominio (ej: `api-caradvice`)
4. Anotar el token de actualización

### Instalar DuckDNS Updater

```bash
# Crear script de actualización
sudo mkdir -p /opt/duckdns
sudo nano /opt/duckdns/update.sh
```

Contenido del script:

```bash
#!/bin/bash
echo url="https://www.duckdns.org/update?domains=TU_SUBDOMINIO&token=TU_TOKEN&ip=" | curl -k -o /opt/duckdns/duck.log -K -
```

Reemplazar:
- `TU_SUBDOMINIO`: El subdominio creado (ej: `api-caradvice`)
- `TU_TOKEN`: El token de actualización

Hacer ejecutable:

```bash
sudo chmod +x /opt/duckdns/update.sh
```

### Configurar Cron para Actualización Automática

```bash
sudo crontab -e
```

Agregar línea (actualizar cada 5 minutos):

```
*/5 * * * * /opt/duckdns/update.sh >/dev/null 2>&1
```

### Probar Actualización Manual

```bash
/opt/duckdns/update.sh
cat /opt/duckdns/duck.log
```

Debería mostrar: `OK`

### Verificar Acceso

```bash
# Obtener IP pública del servidor
curl ifconfig.me

# Probar acceso por DuckDNS
curl http://TU_SUBDOMINIO.duckdns.org:4000/health
```

---

## 8️⃣ Configuración de Nginx (Opcional pero Recomendado)

### Instalar Nginx

```bash
sudo apt install -y nginx
```

### Crear Configuración

```bash
sudo nano /etc/nginx/sites-available/caradvice-api
```

Contenido:

```nginx
server {
    listen 80;
    server_name TU_SUBDOMINIO.duckdns.org;

    # Logs
    access_log /var/log/nginx/caradvice-api-access.log;
    error_log /var/log/nginx/caradvice-api-error.log;

    # Tamaño máximo de archivos
    client_max_body_size 50M;

    # Proxy a la API
    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Cache para medios estáticos
    location /media/ {
        proxy_pass http://localhost:4000;
        proxy_cache_valid 200 7d;
        proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
        add_header Cache-Control "public, max-age=604800, immutable";
    }
}
```

### Habilitar Sitio

```bash
# Crear enlace simbólico
sudo ln -s /etc/nginx/sites-available/caradvice-api /etc/nginx/sites-enabled/

# Verificar configuración
sudo nginx -t

# Reiniciar Nginx
sudo systemctl restart nginx

# Habilitar inicio automático
sudo systemctl enable nginx
```

### Verificar

```bash
# Verificar estado
sudo systemctl status nginx

# Probar acceso
curl http://TU_SUBDOMINIO.duckdns.org/health
```

---

## 9️⃣ Verificación y Pruebas

### Verificar Endpoints

```bash
# Health check
curl http://TU_SUBDOMINIO.duckdns.org/health

# Listado de vehículos
curl http://TU_SUBDOMINIO.duckdns.org/autos

# Filtros
curl http://TU_SUBDOMINIO.duckdns.org/autos/filters/options

# Información de filtros
curl http://TU_SUBDOMINIO.duckdns.org/filters/info
```

### Verificar Servicio de Medios

```bash
# Si hay una imagen en /opt/caradvice-media/images/autos/1/test.jpg
curl http://TU_SUBDOMINIO.duckdns.org/media/images/autos/1/test.jpg

# Verificar headers de cache
curl -I http://TU_SUBDOMINIO.duckdns.org/media/images/autos/1/test.jpg
```

Debería mostrar:
```
Cache-Control: public, max-age=604800, immutable
```

### Verificar Logs

```bash
# Logs de PM2
pm2 logs caradvice-api --lines 50

# Logs de la aplicación
tail -f /opt/caradvice-api/backend/logs/error.log
tail -f /opt/caradvice-api/backend/logs/sync.log
```

### Verificar Base de Datos

```bash
sudo mysql -u caradvice_user -p caradvice_db

# Verificar tablas
SHOW TABLES;

# Verificar vehículos
SELECT COUNT(*) FROM vehicles;

# Salir
EXIT;
```

---

## 🔟 Mantenimiento

### Redeploy por FTP

1. **Subir nuevos archivos** (excepto `node_modules`, `uploads`, `dist`, `.env`)
2. **En el servidor:**

```bash
cd /opt/caradvice-api/backend

# Instalar nuevas dependencias si hay cambios en package.json
npm install --production

# Recompilar
npm run build

# Reiniciar PM2
pm2 restart caradvice-api

# Verificar logs
pm2 logs caradvice-api --lines 20
```

### Backups de MySQL

#### Crear Script de Backup

```bash
sudo nano /opt/backups/mysql-backup.sh
```

Contenido:

```bash
#!/bin/bash
BACKUP_DIR="/opt/backups/mysql"
DATE=$(date +%Y%m%d_%H%M%S)
DB_NAME="caradvice_db"
DB_USER="caradvice_user"
DB_PASS="TU_PASSWORD_AQUI"

mkdir -p $BACKUP_DIR

mysqldump -u $DB_USER -p$DB_PASS $DB_NAME | gzip > $BACKUP_DIR/caradvice_db_$DATE.sql.gz

# Mantener solo los últimos 7 días
find $BACKUP_DIR -name "caradvice_db_*.sql.gz" -mtime +7 -delete

echo "Backup creado: caradvice_db_$DATE.sql.gz"
```

Hacer ejecutable:

```bash
sudo chmod +x /opt/backups/mysql-backup.sh
```

#### Configurar Cron para Backups Diarios

```bash
sudo crontab -e
```

Agregar (backup diario a las 2 AM):

```
0 2 * * * /opt/backups/mysql-backup.sh
```

### Monitoreo

#### Verificar Estado del Servidor

```bash
# Estado de PM2
pm2 status

# Uso de recursos
pm2 monit

# Espacio en disco
df -h

# Memoria
free -h

# Procesos
top
```

### Logs

#### Ubicación de Logs

- **PM2**: `/opt/caradvice-api/backend/logs/pm2-*.log`
- **Aplicación**: `/opt/caradvice-api/backend/logs/error.log` y `sync.log`
- **Nginx**: `/var/log/nginx/caradvice-api-*.log`

#### Rotación de Logs

PM2 maneja logs automáticamente. Para Nginx:

```bash
sudo nano /etc/logrotate.d/nginx-caradvice
```

Contenido:

```
/var/log/nginx/caradvice-api-*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data adm
    sharedscripts
    postrotate
        [ -f /var/run/nginx.pid ] && kill -USR1 `cat /var/run/nginx.pid`
    endscript
}
```

---

## 📝 Notas Importantes

### Seguridad

- ✅ **Nunca** subir `.env` al repositorio
- ✅ Usar contraseñas seguras para MySQL
- ✅ Mantener el sistema actualizado: `sudo apt update && sudo apt upgrade`
- ✅ Revisar logs regularmente para detectar problemas

### Preparación para HTTPS

La configuración actual está lista para HTTPS. Cuando estés listo:

1. Instalar Certbot: `sudo apt install certbot python3-certbot-nginx`
2. Obtener certificado: `sudo certbot --nginx -d TU_SUBDOMINIO.duckdns.org`
3. Certbot configurará Nginx automáticamente

### Troubleshooting

#### El servidor no inicia

```bash
# Ver logs de PM2
pm2 logs caradvice-api

# Verificar variables de entorno
cd /opt/caradvice-api/backend
cat .env

# Verificar conexión a MySQL
sudo mysql -u caradvice_user -p caradvice_db
```

#### Error de permisos

```bash
# Verificar permisos
ls -la /opt/caradvice-api/backend
ls -la /opt/caradvice-media

# Corregir permisos
sudo chown -R $USER:$USER /opt/caradvice-api
sudo chown -R $USER:$USER /opt/caradvice-media
```

#### Puerto ya en uso

```bash
# Ver qué proceso usa el puerto 4000
sudo lsof -i :4000

# O
sudo netstat -tlnp | grep 4000
```

---

## ✅ Checklist Final

- [ ] Backend compilado y funcionando
- [ ] MySQL configurado y conectado
- [ ] PM2 corriendo y configurado para inicio automático
- [ ] DuckDNS configurado y actualizando
- [ ] Nginx configurado (opcional)
- [ ] Endpoints accesibles públicamente
- [ ] Medios servidos correctamente
- [ ] Cache funcionando
- [ ] Logs funcionando
- [ ] Backups configurados

---

## 🎉 ¡Despliegue Completado!

El backend está ahora funcionando en producción. Para cualquier problema, revisar los logs y esta guía.

**Endpoints principales:**
- Health: `http://TU_SUBDOMINIO.duckdns.org/health`
- Vehículos: `http://TU_SUBDOMINIO.duckdns.org/autos`
- Medios: `http://TU_SUBDOMINIO.duckdns.org/media/images/*`



- - -
Create a file containing just this data:

UAMJjNWzNb1bZmnqc2ZM5SrFIuXFlFx1EUPfbVn8dV0.gvdYE8gytaWqxBLS98N81n9o_9oPNzeWYcHKJyxiQ9M

And make it available on your web server at this URL:

http://api-caradvice.duckdns.org/.well-known/acme-challenge/UAMJjNWzNb1bZmnqc2ZM5SrFIuXFlFx1EUPfbVn8dV0
