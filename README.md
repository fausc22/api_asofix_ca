# Backend API - CarAdvice

API profesional en Node.js + Express para sincronización de vehículos desde ASOFIX.

## 🚀 Inicio Rápido

### 1. Instalar dependencias

```bash
cd backend
npm install
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env
# Editar .env con tus credenciales
```

### 3. Iniciar servidor

```bash
# Desarrollo
npm run dev

# Producción
npm run build
npm start
```

### 4. Carga inicial

```bash
npm run sync:inicial
```

## 📚 Documentación

- **[README Principal](docs/README.md)** - Documentación completa de la API
- **[Decisiones Técnicas](docs/DECISIONES_TECNICAS.md)** - Explicación de decisiones técnicas
- **[Mejoras Propuestas](docs/MEJORAS_PROPUESTAS.md)** - Propuestas de mejoras futuras

## 🎯 Características Principales

✅ **Filtros Obligatorios Automáticos**
- No Dakota
- Precio > 1
- Estado != reservado
- Al menos una imagen

✅ **Sincronización Inteligente**
- Carga inicial completa
- Sincronización incremental cada 1 hora
- Detección de cambios con hash de versión

✅ **API Clara y Documentada**
- Endpoints bien definidos
- Documentación completa
- Fácil de entender y mantener

## 📡 Endpoints Principales

- `GET /health` - Estado del servidor
- `GET /autos` - Lista de vehículos (con filtros)
- `GET /autos/:id` - Vehículo por ID
- `POST /sync/inicial` - Carga inicial completa
- `POST /sync/cron` - Sincronización incremental
- `GET /filters/info` - Información de filtros

## 🔧 Configuración

Ver [.env.example](.env.example) para todas las opciones de configuración.

## 📖 Más Información

Consulta la [documentación completa](docs/README.md) para más detalles.

