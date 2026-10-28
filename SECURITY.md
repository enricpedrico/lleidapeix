# Seguridad de LleidaPeix

Revisión y despliegue: 28 de octubre de 2026. Correcciones instaladas en producción desde el commit `a191706`, con copias privadas previas y configuración conservada. Repositorio público; configuración privada y datos fuera de Git. La administración protegida es compatible con un repositorio público.

## Controles y correcciones

- `ADMIN_TOKEN` vacío, corto o con marcadores de ejemplo deja la administración desactivada. Para habilitarla usar un secreto aleatorio de 32 bytes, por ejemplo generado con `openssl rand -hex 32`, guardado fuera de Git. Longitud admitida: 32–256 caracteres.
- La API rechaza orígenes web distintos del Host, incluidas conexiones WebSocket, y responde con `Cache-Control: no-store`. Clientes sin Origin siguen admitidos; Origin no es un mecanismo de autenticación.
- Límites globales de peticiones: ráfaga de 120, recuperación de 20 por segundo; creación de partidas: ráfaga de 20 y recuperación de una por minuto. Son globales por proceso, no por IP, y no confían en X-Forwarded-For. Máximo cuatro peticiones API en curso; health queda fuera de estos límites.
- El motor admite un análisis ejecutándose y hasta tres WebSocket esperando. La reserva es atómica antes del upgrade: las solicitudes concurrentes no eluden el límite. Los mensajes y frames se limitan a 1 KiB.
- Se leen cierres WebSocket mientras se espera o se calcula; cancelar libera la cola. El trabajo de CPU conserva su permiso hasta terminar el lote, aunque el cliente se desconecte. El análisis HTTP también valida y calcula bajo su permiso. Un cliente lento tiene un tiempo máximo de envío de actualizaciones.
- Caché acotada a 256 partidas y almacenamiento a 10.000; la creación comprueba la capacidad junto a la inserción bajo el bloqueo de conexión. La expulsión de caché conserva SQLite y permite recuperar la partida. No se borran partidas existentes al alcanzar la capacidad. La limpieza por antigüedad existente se ejecuta al arrancar; no se ha añadido un borrado periódico.
- Consultas SQL parametrizadas; el estado público no serializa manos ocultas ni la semilla interna. Entradas JSON limitadas a 64 KiB y validación de cartas, asientos y longitud de historial.
- Node.js 24 LTS para la interfaz, lockfiles actualizados y Tokio actualizado a 1.54.1. El contenedor del backend conserva Rust 1.86.
- Escucha independiente por defecto en loopback; Docker usa `BIND_ADDRESS=0.0.0.0` con publicación del puerto solo en loopback en Compose. Proceso sin privilegios, sistema de archivos de solo lectura y datos separados.

## Modelo de acceso de las partidas

No hay cuentas ni una autenticación por jugador. La URL contiene un identificador UUID aleatorio y actúa como una capacidad: quien la conozca puede consultar y modificar esa partida. No compartirla si se quiere conservar el control exclusivo. No se debe presentar este diseño como aislamiento entre usuarios autenticados. Si se necesita ese aislamiento, habrá que añadir sesiones y autorización por propietario antes de ofrecer esa función.

## Dependencias y aviso pendiente del escáner

`npm audit --json` no devuelve avisos tras la actualización, incluyendo desarrollo; antes devolvía cuatro. Node.js 20 está fuera de soporte según el [calendario oficial](https://nodejs.org/en/about/previous-releases).

OSV sobre los 143 paquetes de registro del `Cargo.lock` devolvió inicialmente dos avisos. Se ha corregido `RUSTSEC-2026-0386` actualizando Tokio. Sigue apareciendo `GHSA-qwgh-2vcv-g2f7` para la dependencia transitiva `block-buffer` 0.10.4, por el rango amplio del [aviso original](https://github.com/RustCrypto/utils/security/advisories/GHSA-qwgh-2vcv-g2f7).

Se considera no aplicable al mecanismo descrito en ese aviso en esta versión concreta: se verificó el código del paquete contra el checksum del lockfile y el cursor de 0.10.4 es un campo `pos: u8` separado del buffer, no el cursor integrado descrito en `EagerBuffer`/`ReadBuffer`. Una prueba de regresión externa reprodujo el callback con pánico capturado: posición y datos se conservaron. Además, el perfil de producción usa `panic="abort"`. Esta clasificación manual no equivale a que el escáner devuelva cero ni a una prueba exhaustiva con Miri; debe revisarse si cambia la dependencia. No se ha silenciado el aviso globalmente ni se ha forzado una versión incompatible de la dependencia transitiva.

## Verificación de esta revisión

- 35 pruebas Rust pasan mediante `cargo test --locked`, más `cargo build --locked`, con Rust 1.86 en su contenedor oficial.
- 13 pruebas de interfaz y `npm run build` pasan en Node.js 24.
- Pruebas de router sobre origen, token administrativo, límites, datos ocultos, caché, almacenamiento, entradas y reservas concurrentes.
- `cargo build --locked` y `npm run test:security` prueban conexiones reales con un servidor local, SQLite temporal y credenciales generadas: 12 upgrades concurrentes admiten cuatro; cancelar vacía la cola; desconectar un análisis HTTP no permite solapar trabajo de CPU; solicitudes posteriores vuelven a funcionar.
- Gitleaks sobre todo el historial exportado y el árbol de publicación: sin hallazgos de secretos.

## Antes de hacer público y desplegar

1. En futuras actualizaciones, respaldar SQLite y conservar `.env`. El despliegue del 28 de octubre ya está verificado por HTTPS: creación de partida, jugadas y análisis WebSocket completo. El repositorio se ha hecho público tras verificar el despliegue.
2. Reconstruir con los lockfiles y las versiones documentadas; conservar las restricciones de Compose, el proxy HTTPS y los permisos del volumen `data` para el usuario UID/GID 1000.
3. Mantener `ADMIN_TOKEN` vacío si no se usa la administración o sustituirlo por un secreto aleatorio. No publicar `.env`, URLs privadas de partidas, bases de datos, respaldos ni tokens.
4. Revisar periódicamente dependencias y avisos, incluido el aviso transitivo clasificado manualmente.

## Alcance y límites

Revisión de las rutas, serialización, motor accesible por red, persistencia, configuración, recursos y dependencias del código exportado. No cubre una auditoría completa de infraestructura, pruebas de penetración de producción ni fuzzing exhaustivo del motor. Los límites son globales y pueden rechazar también tráfico legítimo durante una saturación; se ha priorizado mantener acotado el trabajo. La revisión inicial compiló los componentes por separado. Para el despliegue posterior se construyó la imagen completa, pasaron 35 pruebas Rust en release y las pruebas de concurrencia y cancelación sobre la propia imagen, y se verificó juego y análisis por HTTPS tras instalarla.

Para comunicar vulnerabilidades, usar un canal privado o la notificación privada de GitHub si se habilita. No publicar secretos en issues.
