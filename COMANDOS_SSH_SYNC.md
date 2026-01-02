# 🚀 Comandos SSH para Sincronización Inicial

## 📋 Pasos Rápidos (Copia y Pega)

### 1. Conectar por SSH

```bash
ssh usuario@tu-servidor
```

### 2. Ir al directorio del backend

```bash
cd /opt/caradvice-api/backend
```

### 3. Verificar entorno

```bash
# Verificar que existe .env
ls -la .env

# Verificar variables de ASOFIX
cat .env | grep ASOFIX

# Verificar que existe el código
ls -la src/scripts/sync-inicial.ts
```

### 4. Instalar ts-node si falta

```bash
npm install ts-node --save-dev
```

### 5. Ejecutar sincronización inicial

```bash
npm run sync:inicial
```

### 6. En otra terminal SSH, monitorear logs

```bash
# Terminal 2: Ver logs en tiempo real
tail -f /opt/caradvice-api/backend/logs/sync.log

# O ver errores
tail -f /opt/caradvice-api/backend/logs/error.log
```

## 🔍 Verificar Progreso Mientras Se Ejecuta

### Verificar base de datos

```bash
# En otra terminal SSH
sudo mysql -u caradvice_user -p caradvice_db

# Dentro de MySQL:
SELECT COUNT(*) as vehiculos FROM vehicles;
SELECT COUNT(*) as imagenes FROM vehicle_images;
SELECT COUNT(*) as pendientes FROM pending_images;

# Ver últimos vehículos creados
SELECT id, title, created_at FROM vehicles ORDER BY created_at DESC LIMIT 5;

# Salir
EXIT;
```

### Verificar carpetas de imágenes

```bash
# Ver si se están creando carpetas
ls -la /opt/caradvice-media/images/autos/ | head -20

# Contar carpetas creadas
ls -d /opt/caradvice-media/images/autos/*/ 2>/dev/null | wc -l

# Ver una carpeta específica
ls -la /opt/caradvice-media/images/autos/1/
```

### Verificar espacio en disco

```bash
# Ver espacio disponible
df -h /opt/caradvice-media

# Ver tamaño de imágenes descargadas
du -sh /opt/caradvice-media/images/autos/
```

## 🐛 Troubleshooting Rápido

### Si dice "Cannot find module 'ts-node'"

```bash
cd /opt/caradvice-api/backend
npm install ts-node --save-dev
```

### Si dice "Permission denied" en imágenes

```bash
sudo chown -R $USER:$USER /opt/caradvice-media
chmod -R 755 /opt/caradvice-media
```

### Si no hay logs

```bash
# Verificar que el directorio de logs existe
ls -la /opt/caradvice-api/backend/logs/

# Si no existe, crearlo
mkdir -p /opt/caradvice-api/backend/logs
chmod 755 /opt/caradvice-api/backend/logs
```

### Si falla la conexión a MySQL

```bash
# Verificar que MySQL está corriendo
sudo systemctl status mysql

# Probar conexión manual
sudo mysql -u caradvice_user -p caradvice_db -e "SELECT 1;"
```

### Si falla la conexión a ASOFIX

```bash
# Probar manualmente
curl -H "Authorization: Bearer QIXMu940jbMM1KFjPK2ev5t5Wt+cbO0NX5MqwnM2RzAKgeIFj//WtQ==" \
     "https://app.asofix.com/api/catalogs/web/vehicles?page=1"
```

## ✅ Verificar que Completó Correctamente

### Después de que termine, ejecutar:

```bash
# 1. Ver resumen en logs
tail -50 /opt/caradvice-api/backend/logs/sync.log | grep -E "completada|Resumen|Procesados|Nuevos"

# 2. Verificar vehículos en BD
sudo mysql -u caradvice_user -p caradvice_db -e "
SELECT 
    COUNT(*) as total_vehiculos,
    COUNT(DISTINCT featured_image_id) as con_imagen_destacada
FROM vehicles 
WHERE status = 'published';"

# 3. Verificar imágenes descargadas
sudo mysql -u caradvice_user -p caradvice_db -e "
SELECT 
    COUNT(*) as total_imagenes,
    COUNT(DISTINCT vehicle_id) as vehiculos_con_imagenes
FROM vehicle_images;"

# 4. Probar endpoint de API
curl https://api-caradvice.duckdns.org/autos?limit=3 | jq '.data.vehicles | length'

# 5. Verificar que las imágenes se sirven
# (Reemplaza 1 con un ID real de vehículo)
curl -I "https://api-caradvice.duckdns.org/api/image?path=/opt/caradvice-media/images/autos/1/imagen.jpg"
```

## 📊 Ejemplo de Salida Esperada

Cuando la sincronización funciona correctamente, deberías ver algo como:

```
🚀 Iniciando carga inicial completa de vehículos...
📋 Filtros obligatorios que se aplicarán:
   - Concesionarias bloqueadas: dakota
   - Precio mínimo: 1
   - Estados bloqueados: reservado
   - Requiere imágenes: Sí

[FASE1] Procesando vehículos... (10%)
[FASE1] Procesando vehículos... (20%)
...
[FASE1] Fase 1 completada: 150 vehículos procesados
[FASE2] Descargando imágenes... (5%)
[FASE2] Descargando imágenes... (10%)
...
[FASE2] Fase 2 completada: 750 imágenes descargadas

🎉 Carga inicial completada exitosamente!

📊 Resumen:
   Fase 1 (Datos):
     - Procesados: 150
     - Nuevos: 150
     - Actualizados: 0
     - Filtrados: 25
     - Errores: 0
   Fase 2 (Imágenes):
     - Procesadas: 750
     - Nuevas: 750
     - Errores: 0

✅ Los vehículos están listos para ser consumidos por la web
```

## ⏱️ Tiempo Estimado

- **100 vehículos con 5 imágenes cada uno**: ~15-30 minutos
- **500 vehículos con 5 imágenes cada uno**: ~1-2 horas
- **1000+ vehículos**: ~2-4 horas

**No te preocupes si tarda mucho**, es normal. Lo importante es que veas progreso en los logs.

---

**¡Ejecuta estos comandos y comparte qué ves en los logs!** 🔍


