# LleidaPeix

Motor de análisis y entrenamiento de botifarra occidental.

- Juego, análisis y entrenamiento de botifarra occidental.
- Motor en Rust con información limitada a lo que conoce el jugador analizado.
- Interfaz de mesa, historial, recomendaciones, baraja tradicional y preferencias locales.

## Estado del repositorio

Repositorio **privado con código y recursos necesarios para reconstruir la aplicación. La base se ha contrastado con los archivos del servidor el 28 de octubre de 2026. No incluye el historial de despliegues ni datos persistentes.

## Desarrollo

Node.js 20.20 o superior y npm; las versiones exactas se fijan en `package-lock.json`. Además, Rust y Cargo para el backend.

```bash
npm ci
npm run dev
# En otra terminal:
cargo run
```

## Configuración

Copia `.env.example` a `.env` y sustituye los valores de ejemplo. Nunca subas `.env`. Variables documentadas:

- `PORT`
- `DATABASE_PATH`
- `ADMIN_TOKEN`
- `RUST_LOG`

## Estructura

`src/`: interfaz de usuario; `public/`: recursos estáticos; `tests/`: pruebas.

## Verificación

```bash
npm test
npm run build
cargo test
```

## Despliegue y datos

La configuración Compose del repositorio es la referencia. Prepara las variables y el directorio de datos, después ejecuta `docker compose up -d --build`. Los puertos de la aplicación deben permanecer ligados a loopback, detrás del proxy HTTPS.

No se han incluido `.env`, tokens, contraseñas, sesiones, bases de datos, archivos subidos, biblioteca multimedia, cachés o copias de seguridad. Las copias de datos se gestionan aparte; subir el código no sustituye un respaldo. Antes de actualizar una instalación conserva sus datos y configuración. No uses `docker compose down -v` para una actualización normal.

## Documentación original

[README original](README.original.md), conservado con los detalles de funcionamiento y las instrucciones específicas del proyecto. Se conservan los avisos de terceros incluidos; no se ha añadido una licencia nueva.
