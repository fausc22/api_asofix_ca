# API Backend - CarAdvice

## 📋 Descripción General

Esta API profesional en Node.js + Express se encarga de integrarse con ASOFIX para obtener el catálogo completo de autos y servir esos datos a la página web. La API aplica filtros obligatorios automáticamente para garantizar que solo se muestren vehículos que cumplan con los criterios de negocio.

## 🎯 Objetivos

1. **Sincronización con ASOFIX**: Obtener el catálogo completo de vehículos desde la API de ASOFIX
2. **Filtrado Inteligente**: Aplicar filtros obligatorios para mostrar solo vehículos válidos
3. **Sincronización Automática**: Mantener los datos actualizados mediante cron jobs
4. **API Clara y Documentada**: Endpoints bien definidos y documentados

## 🏗️ Arquitectura

```
backend/
├── src/
│   ├── config/          # Configuración (BD, filtros)
│   ├── controllers/     # Controladores de endpoints
│   ├── routes/          # Definición de rutas
│   ├── services/        # Lógica de negocio
│   │   ├── asofix-api.ts        # Cliente de API ASOFIX
│   │   ├── sync-service.ts      # Servicio de sincronización
│   │   ├── vehicle-filters.ts   # Filtros obligatorios
│   │   └── logger.ts            # Sistema de logging
│   ├── jobs/            # Cron jobs
│   │   └── sync-cron.ts         # Cron de sincronización
│   └── index.ts         # Servidor Express
├── docs/               # Documentación
└── package.json
```

## 🔌 Conexión con ASOFIX

### Configuración

La API se conecta a ASOFIX mediante:
- **Endpoint**: `https://app.asofix.com/api/catalogs/web`
- **Autenticación**: Header `x-api-key` con la API Key

### Variables de Entorno

```env
ASOFIX_API_KEY=tu_api_key_aqui
ASOFIX_API_ENDPOINT=https://app.asofix.com/api/catalogs/web
```

### Documentación Oficial

Para más detalles sobre la API de ASOFIX, consultar:
https://grupotagle.atlassian.net/wiki/external/YTFiOTZjMDlkMTRhNDVhMGE0NTMxNWY3MmNiN2M1NDU

## 🚫 Filtros Obligatorios

Los vehículos que se exponen a la página web **DEBEN** cumplir **TODAS** estas condiciones:

### 1. No pertenecer a concesionaria bloqueada
- **Por defecto**: "Dakota"
- **Configuración**: Variable `BLOCKED_BRANCH_OFFICES`
- **Aplicación**: Se verifica el campo `branch_office_name` en el stock activo

### 2. Precio mayor al mínimo
- **Por defecto**: Precio > 1
- **Configuración**: Variable `MIN_PRICE`
- **Aplicación**: Se verifica `price.list_price` del vehículo

### 3. Estado distinto de estados bloqueados
- **Por defecto**: Estado != "reservado"
- **Configuración**: Variable `BLOCKED_STATUSES`
- **Aplicación**: Se verifica el `status` del stock activo

### 4. Debe tener al menos una imagen
- **Por defecto**: Requerido (true)
- **Configuración**: Variable `REQUIRE_IMAGES`
- **Aplicación**: Se verifica que el vehículo tenga al menos una imagen en `vehicle.images`

### Configuración de Filtros

```env
BLOCKED_BRANCH_OFFICES=Dakota
MIN_PRICE=1
BLOCKED_STATUSES=reservado
REQUIRE_IMAGES=true
```

### Aplicación de Filtros

Los filtros se aplican en **dos lugares**:

1. **Durante la sincronización**: Los vehículos que no pasan los filtros no se guardan en la BD (o se marcan como `archived`)
2. **En los endpoints públicos**: Los endpoints `/autos` y `/autos/:id` aplican los filtros en las consultas SQL

Esto garantiza que:
- Los datos en la BD ya están filtrados
- Los endpoints públicos tienen una capa adicional de seguridad
- No se muestran vehículos que no cumplen los criterios

## 📡 Endpoints

### Health Check

```
GET /health
```

Verifica el estado del servidor y muestra la configuración de filtros.

**Respuesta:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "filters": {
    "blockedBranchOffices": ["dakota"],
    "minPrice": 1,
    "blockedStatuses": ["reservado"],
    "requireImages": true
  },
  "cron_active": true
}
```

### Obtener Vehículos

```
GET /autos
```

Obtiene una lista paginada de vehículos con filtros opcionales.

**Query Parameters:**
- `page` (number, default: 1): Número de página
- `limit` (number, default: 20): Cantidad por página
- `brand` (string): Filtrar por marca
- `model` (string): Filtrar por modelo
- `condition` (string): Filtrar por condición (0KM, Usado)
- `minPrice` (number): Precio mínimo
- `maxPrice` (number): Precio máximo
- `minYear` (number): Año mínimo
- `maxYear` (number): Año máximo
- `currency` (string): Moneda (USD, ARS)
- `search` (string): Búsqueda en título y descripción
- `sortBy` (string): Campo de ordenamiento (created_at, year, price, etc.)
- `sortOrder` (string): Orden (ASC, DESC)

**Respuesta:**
```json
{
  "success": true,
  "data": {
    "vehicles": [
      {
        "id": 1,
        "asofix_id": "12345",
        "title": "Toyota Corolla 2023",
        "year": 2023,
        "price_usd": 25000,
        "price_ars": null,
        "featured_image_path": "/uploads/vehicles/1/image.jpg",
        "taxonomies": {
          "brand": ["Toyota"],
          "model": ["Corolla"],
          "condition": ["0KM"]
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 370,
      "totalPages": 19
    },
    "filters_applied": {
      "blockedBranchOffices": ["dakota"],
      "minPrice": 1,
      "blockedStatuses": ["reservado"],
      "requireImages": true
    }
  }
}
```

**Nota**: Los filtros obligatorios se aplican automáticamente. El campo `total` refleja solo los vehículos que pasan los filtros.

### Obtener Vehículo por ID

```
GET /autos/:id
```

Obtiene un vehículo específico por su ID.

**Respuesta:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "asofix_id": "12345",
    "title": "Toyota Corolla 2023",
    "content": "Descripción del vehículo...",
    "images": [
      {
        "image_url": "https://...",
        "file_path": "/uploads/vehicles/1/image1.jpg"
      }
    ],
    "taxonomies": {
      "brand": ["Toyota"],
      "model": ["Corolla"]
    }
  },
  "filters_applied": {
    "blockedBranchOffices": ["dakota"],
    "minPrice": 1,
    "blockedStatuses": ["reservado"],
    "requireImages": true
  }
}
```

Si el vehículo no existe o no cumple con los filtros obligatorios, retorna 404.

### Información de Filtros

```
GET /filters/info
```

Obtiene información sobre los filtros configurados.

**Respuesta:**
```json
{
  "success": true,
  "data": {
    "filters": {
      "blockedBranchOffices": ["dakota"],
      "minPrice": 1,
      "blockedStatuses": ["reservado"],
      "requireImages": true
    },
    "description": {
      "blockedBranchOffices": "Concesionarias que están bloqueadas y no se muestran en la web",
      "minPrice": "Precio mínimo permitido (en USD o ARS)",
      "blockedStatuses": "Estados de stock que están bloqueados y no se muestran",
      "requireImages": "Si es true, solo se muestran vehículos con al menos una imagen"
    }
  }
}
```

### Sincronización Inicial

```
POST /sync/inicial
```

Carga inicial completa de todos los autos desde ASOFIX. Aplica todos los filtros obligatorios durante la sincronización.

**Características:**
- Usa Server-Sent Events (SSE) para reportar progreso en tiempo real
- Procesa todos los vehículos de ASOFIX
- Aplica filtros obligatorios antes de guardar
- Descarga todas las imágenes asociadas

**Uso:**
```bash
curl -X POST http://localhost:3002/sync/inicial
```

O desde el navegador, abrir la URL y ver el progreso en tiempo real.

### Sincronización Incremental (Cron)

```
POST /sync/cron
```

Sincronización incremental que solo actualiza vehículos que han cambiado. Diseñado para ser llamado por el cron job.

**Características:**
- Solo procesa vehículos que han cambiado (usando hash de versión)
- Más rápido que la sincronización inicial
- Ideal para ejecutarse periódicamente

**Respuesta:**
```json
{
  "success": true,
  "message": "Sincronización incremental completada",
  "data": {
    "summary": {
      "vehicles": {
        "processed": 50,
        "created": 5,
        "updated": 10,
        "filtered": 2,
        "errors": 0
      },
      "images": {
        "processed": 100,
        "created": 20,
        "errors": 0
      }
    }
  }
}
```

## ⏰ Cron Job de Sincronización

### Configuración

El cron job se ejecuta automáticamente cada 1 hora por defecto.

**Variables de Entorno:**
```env
ENABLE_AUTO_SYNC=true
SYNC_CRON_SCHEDULE=0 * * * *
TZ=America/Argentina/Buenos_Aires
```

### Formato de Cron

El formato es estándar de cron: `minuto hora día mes día-semana`

Ejemplos:
- `0 * * * *` - Cada hora en el minuto 0
- `0 */2 * * *` - Cada 2 horas
- `0 4 * * *` - Todos los días a las 4:00 AM
- `*/30 * * * *` - Cada 30 minutos

### Funcionamiento

1. El cron job se inicia automáticamente al iniciar el servidor (si `ENABLE_AUTO_SYNC=true`)
2. Ejecuta una sincronización incremental cada hora
3. Verifica cambios en vehículos usando hash de versión
4. Solo actualiza vehículos que han cambiado
5. Descarga nuevas imágenes si es necesario

### Logs

Los logs del cron job se guardan en:
- `logs/sync.log` - Logs generales
- `logs/error.log` - Solo errores

## 🔄 Proceso de Sincronización

### Fase 1: Sincronización de Datos

1. Obtiene vehículos de ASOFIX página por página
2. Filtra vehículos activos (stock con status "ACTIVO")
3. **Aplica filtros obligatorios**:
   - Verifica concesionaria (no Dakota)
   - Verifica precio (> 1)
   - Verifica estado (!= reservado)
   - Verifica imágenes (al menos una)
4. Genera hash de versión para detectar cambios
5. Compara con BD para determinar si necesita actualización
6. Guarda o actualiza vehículo en BD
7. Guarda URLs de imágenes pendientes

### Fase 2: Descarga de Imágenes

1. Obtiene lista de imágenes pendientes
2. Descarga cada imagen una por una
3. Convierte URLs de thumbnail a alta resolución
4. Guarda imágenes en `uploads/vehicles/{vehicle_id}/`
5. Actualiza BD con rutas de imágenes
6. Marca primera imagen como destacada

## 📊 Base de Datos

La API usa la misma base de datos que el servidor anterior (`caradvice`). Las tablas principales son:

- `vehicles` - Vehículos sincronizados
- `taxonomy_terms` - Términos de taxonomía (marcas, modelos, etc.)
- `vehicle_taxonomies` - Relación vehículo-taxonomía
- `vehicle_images` - Imágenes descargadas
- `pending_images` - Imágenes pendientes de descarga

## 🚀 Instalación y Uso

### 1. Instalar dependencias

```bash
cd backend
npm install
```

### 2. Configurar variables de entorno

Copiar `.env.example` a `.env` y configurar:

```bash
cp .env.example .env
```

Editar `.env` con tus credenciales.

### 3. Iniciar servidor

**Desarrollo:**
```bash
npm run dev
```

**Producción:**
```bash
npm run build
npm start
```

### 4. Carga inicial

Ejecutar la sincronización inicial:

```bash
curl -X POST http://localhost:3002/sync/inicial
```

O usar el script:
```bash
npm run sync:inicial
```

## 🔍 Decisiones Técnicas

### 1. Filtros en dos capas

Los filtros se aplican tanto durante la sincronización como en los endpoints públicos. Esto garantiza:
- Datos limpios en la BD
- Seguridad adicional en los endpoints
- Consistencia en los resultados

### 2. Hash de versión para cambios

Se usa un hash SHA-256 de los datos relevantes del vehículo para detectar cambios. Esto permite:
- Sincronización incremental eficiente
- Solo actualizar vehículos que cambiaron
- Evitar cargas completas innecesarias

### 3. Sincronización en dos fases

Separar la sincronización de datos y la descarga de imágenes permite:
- Procesar datos rápidamente
- Descargar imágenes de forma asíncrona
- Mejor manejo de errores

### 4. Server-Sent Events para progreso

La sincronización inicial usa SSE para reportar progreso en tiempo real. Esto permite:
- Monitoreo en tiempo real
- Mejor experiencia de usuario
- Debugging más fácil

## 📝 Logs y Monitoreo

### Logs

Los logs se guardan en:
- `logs/sync.log` - Logs generales de sincronización
- `logs/error.log` - Solo errores

### Niveles de Log

- `info` - Información general
- `warn` - Advertencias
- `error` - Errores

### Monitoreo

El endpoint `/health` proporciona información sobre:
- Estado del servidor
- Configuración de filtros
- Estado del cron job

## ⚠️ Notas Importantes

1. **API Key**: Es necesario tener una API Key válida de ASOFIX
2. **Base de Datos**: La BD debe estar creada y configurada
3. **Permisos**: La carpeta `uploads` debe tener permisos de escritura
4. **Filtros**: Los filtros obligatorios no se pueden desactivar desde los endpoints públicos
5. **Cron Job**: El cron job se ejecuta automáticamente si `ENABLE_AUTO_SYNC=true`

## 🐛 Solución de Problemas

### Error: "La API Key no está configurada"
- Verificar que `ASOFIX_API_KEY` esté en `.env`
- Verificar que el archivo `.env` esté en la raíz de `backend/`

### Error de conexión a MySQL
- Verificar que MySQL esté corriendo
- Revisar credenciales en `.env`
- Verificar que la BD `caradvice` exista

### No se descargan imágenes
- Verificar permisos de escritura en `uploads/`
- Revisar logs en `logs/error.log`
- Verificar conexión a internet

### Los filtros no funcionan
- Verificar configuración en `.env`
- Revisar logs para ver qué filtros se están aplicando
- Usar `/filters/info` para ver la configuración actual

## 📞 Soporte

Para más información sobre la API de ASOFIX, consultar la documentación oficial:
https://grupotagle.atlassian.net/wiki/external/YTFiOTZjMDlkMTRhNDVhMGE0NTMxNWY3MmNiN2M1NDU

