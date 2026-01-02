# 🚀 Guía de Sincronización Inicial

Esta guía te ayudará a ejecutar la primera sincronización completa de vehículos e imágenes desde ASOFIX.

## 📋 Prerequisitos

✅ Backend funcionando en producción (`https://api-caradvice.duckdns.org/health`)  
✅ Base de datos MySQL creada y conectada  
✅ Variables de entorno configuradas correctamente  
✅ Permisos de escritura en `/opt/caradvice-media/images/autos`

## 🔧 Opción 1: Sincronización Inicial vía Endpoint HTTP (Recomendado)

Esta es la forma más fácil y te permite ver el progreso en tiempo real.

### Paso 1: Ejecutar la Sincronización

Puedes usar `curl` o cualquier cliente HTTP. El endpoint devuelve eventos en tiempo real (Server-Sent Events):

```bash
curl -X POST https://api-caradvice.duckdns.org/sync/inicial
```

O si prefieres ver el progreso con mejor formato:

```bash
curl -N -X POST https://api-caradvice.duckdns.org/sync/inicial | while IFS= read -r line; do
  if [[ $line == data:* ]]; then
    echo "$line" | sed 's/data: //' | jq .
  else
    echo "$line"
  fi
done
```

### Paso 2: Monitorear el Progreso

El endpoint devuelve eventos en formato JSON con el progreso:

```json
{"type":"start","message":"🚀 Iniciando carga inicial completa...","timestamp":"..."}
{"type":"progress","phase":"fase1","message":"Procesando vehículos...","progress":{"current":10,"total":100,"percentage":10}}
{"type":"progress","phase":"fase2","message":"Descargando imágenes...","progress":{"current":5,"total":50,"percentage":10}}
{"type":"complete","message":"✅ Carga inicial completada","result":{...}}
```

### Paso 3: Verificar Resultados

Después de completar, verifica:

```bash
# Verificar vehículos en la base de datos
curl https://api-caradvice.duckdns.org/autos?limit=5

# Verificar que las imágenes se están sirviendo
# (reemplaza con una ruta real de imagen)
curl -I https://api-caradvice.duckdns.org/media/images/autos/1/imagen.jpg
```

## 🔧 Opción 2: Sincronización Inicial vía Script (SSH)

Si prefieres ejecutarlo directamente en el servidor:

### Paso 1: Conectar por SSH

```bash
ssh usuario@tu-servidor
```

### Paso 2: Navegar al directorio del backend

```bash
cd /opt/caradvice-api/backend
```

### Paso 3: Ejecutar el script de sincronización

**IMPORTANTE**: Necesitas tener `ts-node` instalado. Si no lo tienes:

```bash
npm install -g ts-node
# O instalar localmente
npm install ts-node --save-dev
```

Luego ejecutar:

```bash
# Opción A: Usando npm script
npm run sync:inicial

# Opción B: Usando ts-node directamente
npx ts-node src/scripts/sync-inicial.ts

# Opción C: Si ya está compilado (menos recomendado)
node dist/scripts/sync-inicial.js
```

### Paso 4: Monitorear Logs

En otra terminal, puedes ver los logs en tiempo real:

```bash
# Logs de PM2
pm2 logs caradvice-api --lines 100

# O logs del archivo
tail -f /opt/caradvice-api/backend/logs/sync.log
```

## ⏱️ Tiempo Estimado

La sincronización inicial puede tardar dependiendo de:
- **Cantidad de vehículos**: ~1-2 segundos por vehículo
- **Cantidad de imágenes**: ~2-5 segundos por imagen
- **Velocidad de conexión**: A ASOFIX y descarga de imágenes

**Estimación**: 
- 100 vehículos con 5 imágenes cada uno ≈ 15-30 minutos
- 500 vehículos con 5 imágenes cada uno ≈ 1-2 horas

## 📊 Qué Hace la Sincronización Inicial

### Fase 1: Sincronización de Datos
1. Obtiene todos los vehículos desde ASOFIX
2. Aplica filtros obligatorios:
   - Excluye concesionarias bloqueadas (Dakota)
   - Excluye estados bloqueados (reservado)
   - Verifica precio mínimo
   - Verifica que tenga imágenes (si `requireImages=true`)
3. Inserta o actualiza vehículos en la base de datos
4. Crea taxonomías (marca, modelo, condición, etc.)
5. Guarda URLs de imágenes en `pending_images` para descarga posterior

### Fase 2: Descarga de Imágenes
1. Obtiene todas las imágenes pendientes
2. Descarga cada imagen desde ASOFIX
3. Guarda en `/opt/caradvice-media/images/autos/{vehicle_id}/`
4. Actualiza la base de datos con las rutas locales
5. Marca la primera imagen como destacada (`featured_image`)

## 🔍 Verificar que Funcionó

### 1. Verificar Base de Datos

```bash
# Conectar a MySQL
sudo mysql -u caradvice_user -p caradvice_db

# Verificar cantidad de vehículos
SELECT COUNT(*) as total_vehiculos FROM vehicles WHERE status = 'published';

# Verificar imágenes descargadas
SELECT COUNT(*) as total_imagenes FROM vehicle_images;

# Ver vehículos con imágenes
SELECT v.id, v.title, COUNT(vi.id) as num_imagenes 
FROM vehicles v 
LEFT JOIN vehicle_images vi ON v.id = vi.vehicle_id 
WHERE v.status = 'published'
GROUP BY v.id 
LIMIT 10;

# Salir
EXIT;
```

### 2. Verificar Endpoints de la API

```bash
# Listar vehículos
curl https://api-caradvice.duckdns.org/autos?limit=5

# Ver un vehículo específico
curl https://api-caradvice.duckdns.org/autos/1

# Ver opciones de filtros
curl https://api-caradvice.duckdns.org/autos/filters/options
```

### 3. Verificar que las Imágenes se Sirven

```bash
# Obtener un vehículo para ver la ruta de imagen
VEHICLE_ID=1
curl https://api-caradvice.duckdns.org/autos/$VEHICLE_ID | jq '.data.featured_image_path'

# Probar acceso a la imagen (reemplaza con ruta real)
curl -I https://api-caradvice.duckdns.org/api/image?path=/opt/caradvice-media/images/autos/1/imagen.jpg
```

### 4. Verificar en el Frontend

Visita tu frontend en Vercel y verifica que:
- Los vehículos se muestran correctamente
- Las imágenes se cargan
- Los filtros funcionan

## 🐛 Troubleshooting

### Error: "Cannot find module 'ts-node'"

```bash
cd /opt/caradvice-api/backend
npm install ts-node --save-dev
```

### Error: "Permission denied" al escribir imágenes

```bash
# Verificar permisos
ls -la /opt/caradvice-media/images/autos

# Corregir permisos
sudo chown -R $USER:$USER /opt/caradvice-media
chmod -R 755 /opt/caradvice-media
```

### Error: "Connection refused" a MySQL

```bash
# Verificar que MySQL está corriendo
sudo systemctl status mysql

# Verificar conexión
sudo mysql -u caradvice_user -p caradvice_db
```

### La sincronización se detiene o falla

1. **Ver logs detallados**:
   ```bash
   pm2 logs caradvice-api --lines 200
   tail -f /opt/caradvice-api/backend/logs/error.log
   ```

2. **Verificar variables de entorno**:
   ```bash
   cd /opt/caradvice-api/backend
   cat .env | grep ASOFIX
   ```

3. **Probar conexión a ASOFIX manualmente**:
   ```bash
   curl -H "Authorization: Bearer TU_API_KEY" \
        https://app.asofix.com/api/catalogs/web/vehicles?page=1
   ```

### Las imágenes no se descargan

1. Verificar espacio en disco:
   ```bash
   df -h /opt/caradvice-media
   ```

2. Verificar permisos de escritura:
   ```bash
   touch /opt/caradvice-media/images/autos/test.txt
   rm /opt/caradvice-media/images/autos/test.txt
   ```

3. Verificar logs de descarga:
   ```bash
   grep "Error al descargar" /opt/caradvice-api/backend/logs/sync.log
   ```

## 🔄 Sincronizaciones Posteriores

Después de la sincronización inicial, el sistema:

1. **Sincronización automática**: Se ejecuta automáticamente según `CRON_SCHEDULE` (por defecto cada 6 horas)
2. **Sincronización manual**: Puedes ejecutarla cuando quieras:
   ```bash
   curl -X POST https://api-caradvice.duckdns.org/sync/manual \
        -H "X-Sync-Token: ca2026"
   ```

## ✅ Checklist Final

- [ ] Sincronización inicial completada sin errores
- [ ] Vehículos visibles en `/autos`
- [ ] Imágenes descargadas y accesibles
- [ ] Frontend muestra vehículos e imágenes correctamente
- [ ] Filtros funcionando correctamente
- [ ] Logs sin errores críticos

---

**¡Listo!** Tu backend debería estar completamente sincronizado y listo para servir datos al frontend. 🎉


