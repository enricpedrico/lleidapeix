# LleidaPeix

## Baralla tradicional (frontend 0.4.1)

- 48 cartes amb punts i figures de baralla espanyola; il·lustracions locals de
  Basquetteur i Germarquezm, CC BY-SA 3.0. Crèdits a `web/public/cards/CREDITS.txt`.
- Primera mà amb cantador aleatori seleccionat per defecte. La sortida continua
  derivant-se reglamentàriament del repartidor.
- Números per defecte, amb selector persistent de lletres. La clau de preferència
  v2 substitueix l'antic valor inicial automàtic; les noves eleccions es conserven.
- `BASE_URL=http://127.0.0.1:3085 npm run test:cards` comprova els quatre seients,
  les 48 il·lustracions, els índexs accessibles i la persistència en tres navegadors.
- `sudo bash scripts/deploy-cards.sh` publica només el frontend sobre la imatge
  activa, amb backup, rollback i verificació que el binari del motor no ha canviat.

Motor públic d'anàlisi i entrenament de botifarra occidental. El servidor conserva el repartiment complet, però el motor només rep la mà del jugador analitzat i la informació deduïble de les cartes jugades.

Producció: `https://botifarra.pedrico.cat`. Caddy conserva la redirecció permanent del domini històric `lleidapeix.pedrico.cat`; aquesta ruta també necessita que el DNS del domini antic continuï actiu.

## Taula 0.4

La mà completa es mostra sense desplaçament horitzontal, amb cartes tàctils de 44 px o més. Les tirades tenen tres fases visuals: arribada, lectura del resultat i recollida cap al guanyador. Els punts només canvien quan es recull la basa. La partida es pausa mentre la pàgina no és visible o es consulta un panell.

Les opcions de taula permeten ajustar el ritme, aturar-se després de cada basa, canviar la nomenclatura i activar el joc amb un sol toc. L'historial mostra totes les bases de la mà. Al mòbil, l'ajuda del motor s'obre en un diàleg amb focus contingut i permet seleccionar una recomanació abans de confirmar-la.

## Desenvolupament

```bash
npm install
npm run dev
cargo run
```

El frontend espera l'API a `127.0.0.1:3085`. Per executar la pila de producció:

```bash
cp .env.example .env
docker compose up --build
```

## Verificació

```bash
npm run build
npm test
cargo test
npm run test:api
npm run test:match
npm run test:e2e
npm run test:browsers
npm run test:table
npm run test:a11y
node tests/recovery.mjs
```

Indica `BASE_URL` explícitament per provar un contenidor aïllat, per exemple `BASE_URL=http://127.0.0.1:18086 npm run test:table`. Les proves creen partides. `test:table` completa una mà amb animacions reals, comprova les 48 accions individuals, pauses, revisió manual, puntuació, mides tàctils, focus i persistència. `test:a11y` comprova les pantalles principals amb axe; no substitueix una revisió manual d'accessibilitat.

`tests/recovery.mjs` comprova desconnexions durant torns humans i automàtics, reintents, moviment reduït, canvi de mà i consulta de la portada offline. Les jugades només es publiquen en memòria després d'un desament correcte a SQLite; una prova Rust injecta un error de persistència i comprova que el reintent continua sent idempotent.

La variant inicial és lliure o occidental. Les partides es conserven durant 30 dies i no hi ha comptes, publicitat ni analítica externa.
