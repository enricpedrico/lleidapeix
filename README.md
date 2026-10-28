# LleidaPeix

Motor de análisis y entrenamiento de botifarra occidental.

- Juego, análisis y entrenamiento de botifarra occidental.
- Motor en Rust con información limitada a lo que conoce el jugador analizado.
- Interfaz de mesa, historial, recomendaciones, baraja tradicional y preferencias locales.

## Estado del repositorio

Repositorio **público** con código y recursos necesarios para reconstruir la aplicación. La base se ha contrastado con los archivos del servidor el 28 de octubre de 2026. No incluye el historial de despliegues ni datos persistentes.

## Desarrollo

Node.js 24 LTS y npm; las versiones exactas se fijan en `package-lock.json`. Además, Rust 1.86 o superior y Cargo para el backend; el contenedor usa Rust 1.86.

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

`src/`: API y motor en Rust; `web/src/`: interfaz; `web/public/`: recursos estáticos; `tests/`: pruebas de integración.

## Verificación

```bash
npm test
npm run build
cargo test --locked
cargo build --locked
npm run test:security
```

## Despliegue y datos

La configuración Compose del repositorio es la referencia. Prepara las variables y el directorio de datos, después ejecuta `docker compose up -d --build`. Los puertos de la aplicación deben permanecer ligados a loopback, detrás del proxy HTTPS.

No se han incluido `.env`, tokens, contraseñas, sesiones, bases de datos, archivos subidos, biblioteca multimedia, cachés o copias de seguridad. Las copias de datos se gestionan aparte; subir el código no sustituye un respaldo. Antes de actualizar una instalación conserva sus datos y configuración. No uses `docker compose down -v` para una actualización normal.

## Seguridad

Correcciones revisadas y desplegadas en el servidor el 28 de octubre de 2026, con copias previas, comprobación de salud y pruebas de juego por HTTPS. El repositorio es público; la configuración privada y los datos se conservan fuera de Git. Consulta [SECURITY.md](SECURITY.md) para los controles, los límites conocidos y la preparación del despliegue. Tener administración protegida no exige que el código sea privado.

## Documentación original

[README original](README.original.md), conservado con los detalles de funcionamiento y las instrucciones específicas del proyecto. Se conservan los avisos de terceros incluidos; no se ha añadido una licencia nueva.
