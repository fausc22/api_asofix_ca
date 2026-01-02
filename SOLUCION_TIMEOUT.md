# 🔧 Solución al Problema de Timeout en Sincronización

## 🔴 Problema Identificado

El endpoint HTTP `/sync/inicial` se cierra después de ~150 segundos debido a:
1. **Nginx timeout**: `proxy_read_timeout 60s` (en la guía de despliegue)
2. **Timeout de conexión**: Varios proxies/intermediarios cortan conexiones largas
3. **Server-Sent Events**: Requieren conexión persistente que puede fallar

## ✅ Solución Recomendada: Ejecutar Directamente en el Servidor

La mejor forma es ejecutar la sincronización directamente en el servidor vía SSH, no por HTTP.

### Paso 1: Conectar por SSH

```bash
ssh usuario@tu-servidor
```

### Paso 2: Ir al directorio del backend

```bash
cd /opt/caradvice-api/backend
```

### Paso 3: Verificar que el código está compilado

```bash
ls -la dist/
```

Si no existe `dist/`, compilar:

```bash
npm run build
```

### Paso 4: Instalar ts-node (si no está)

```bash
# Verificar si está instalado
which ts-node

# Si no está, instalar
npm install ts-node --save-dev
```

### Paso 5: Ejecutar la Sincronización Inicial

```bash
# Opción A: Usando npm script (recomendado)
npm run sync:inicial

# Opción B: Usando ts-node directamente
npx ts-node src/scripts/sync-inicial.ts

# Opción C: Si ya está compilado
node dist/scripts/sync-inicial.js
```

### Paso 6: Monitorear en Tiempo Real

En otra terminal SSH, puedes ver los logs:

```bash
# Ver logs de la aplicación
tail -f /opt/caradvice-api/backend/logs/sync.log

# Ver logs de errores
tail -f /opt/caradvice-api/backend/logs/error.log
```

## 🔍 Verificar que Está Funcionando

Mientras se ejecuta, puedes verificar:

```bash
# Ver procesos de Node
ps aux | grep node

# Ver si se están creando carpetas de imágenes
ls -la /opt/caradvice-media/images/autos/

# Verificar base de datos en tiempo real (en otra terminal)
sudo mysql -u caradvice_user -p caradvice_db -e "SELECT COUNT(*) as total FROM vehicles;"
```

## 🐛 Si Hay Errores

### Error: "Cannot find module"

```bash
# Asegurarse de que las dependencias están instaladas
npm install --production

# Si falta ts-node
npm install ts-node --save-dev
```

### Error: "Permission denied" al escribir imágenes

```bash
# Verificar permisos
ls -la /opt/caradvice-media/images/

# Corregir permisos
sudo chown -R $USER:$USER /opt/caradvice-media
chmod -R 755 /opt/caradvice-media
```

### Error: "Connection refused" a MySQL

```bash
# Verificar que MySQL está corriendo
sudo systemctl status mysql

# Probar conexión
sudo mysql -u caradvice_user -p caradvice_db
```

### Error: "ASOFIX_API_KEY no está configurada"

```bash
# Verificar variables de entorno
cd /opt/caradvice-api/backend
cat .env | grep ASOFIX
```

## 📊 Verificar Resultados Después

Una vez completada la sincronización:

```bash
# Verificar vehículos en la base de datos
sudo mysql -u caradvice_user -p caradvice_db -e "SELECT COUNT(*) as total FROM vehicles WHERE status = 'published';"

# Verificar imágenes descargadas
sudo mysql -u caradvice_user -p caradvice_db -e "SELECT COUNT(*) as total FROM vehicle_images;"

# Ver carpetas de imágenes creadas
ls -la /opt/caradvice-media/images/autos/ | head -20

# Probar endpoint de la API
curl https://api-caradvice.duckdns.org/autos?limit=5
```

## 🔄 Alternativa: Ejecutar en Background

Si quieres ejecutarlo en background y seguir trabajando:

```bash
# Ejecutar en background y guardar output
nohup npm run sync:inicial > /tmp/sync-inicial.log 2>&1 &

# Ver el proceso
jobs

# Ver el log en tiempo real
tail -f /tmp/sync-inicial.log

# Verificar que sigue corriendo
ps aux | grep sync-inicial
```

## ⚙️ Solución Alternativa: Aumentar Timeouts (No Recomendado)

Si realmente necesitas ejecutar por HTTP, necesitas aumentar los timeouts en Nginx:

```nginx
# En /etc/nginx/sites-available/caradvice-api
location /sync/inicial {
    proxy_pass http://localhost:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
    
    # Timeouts aumentados para sincronización larga
    proxy_connect_timeout 300s;
    proxy_send_timeout 3600s;      # 1 hora
    proxy_read_timeout 3600s;      # 1 hora
    
    # Deshabilitar buffering para SSE
    proxy_buffering off;
    proxy_cache off;
}
```

Luego reiniciar Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

**Pero esto no es recomendado** porque:
- Las conexiones HTTP largas son frágiles
- Si se corta la conexión, se pierde el progreso
- Es mejor ejecutar directamente en el servidor

---

**Recomendación final**: Usa SSH y ejecuta `npm run sync:inicial` directamente en el servidor. Es más confiable y puedes ver el progreso completo.


