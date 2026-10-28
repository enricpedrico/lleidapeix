use std::{fs, path::Path};

use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};

use crate::model::Game;

pub struct Database {
    connection: Mutex<Connection>,
}

impl Database {
    pub fn open(path: &str) -> rusqlite::Result<Self> {
        if let Some(parent) = Path::new(path).parent() {
            let _ = fs::create_dir_all(parent);
        }
        let connection = Connection::open(path)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS games (
                id TEXT PRIMARY KEY,
                state_json TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_games_updated_at ON games(updated_at);",
        )?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn save_game(&self, game: &Game) -> Result<(), String> {
        let json = serde_json::to_string(game).map_err(|error| error.to_string())?;
        self.connection
            .lock()
            .execute(
                "INSERT INTO games (id, state_json, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at",
                params![game.id, json, game.updated_at],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn load_game(&self, id: &str) -> Result<Option<Game>, String> {
        let json = self
            .connection
            .lock()
            .query_row("SELECT state_json FROM games WHERE id = ?1", [id], |row| {
                row.get::<_, String>(0)
            })
            .optional()
            .map_err(|error| error.to_string())?;
        json.map(|value| serde_json::from_str(&value).map_err(|error| error.to_string()))
            .transpose()
    }

    pub fn prune_old_games(&self, older_than: i64) -> Result<usize, String> {
        self.connection
            .lock()
            .execute("DELETE FROM games WHERE updated_at < ?1", [older_than])
            .map_err(|error| error.to_string())
    }

    pub fn game_count(&self) -> Result<u64, String> {
        self.connection
            .lock()
            .query_row("SELECT COUNT(*) FROM games", [], |row| row.get(0))
            .map_err(|error| error.to_string())
    }

    pub fn backup_to(&self, path: &str) -> Result<(), String> {
        if let Some(parent) = Path::new(path).parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut destination = Connection::open(path).map_err(|error| error.to_string())?;
        let source = self.connection.lock();
        let backup = rusqlite::backup::Backup::new(&source, &mut destination)
            .map_err(|error| error.to_string())?;
        backup
            .run_to_completion(64, std::time::Duration::from_millis(20), None)
            .map_err(|error| error.to_string())
    }
}
