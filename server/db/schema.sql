-- SACHIN database schema (MySQL 8+). db:init creates/selects DB_NAME first.

-- ── Users ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  name          VARCHAR(120)  NOT NULL,
  email         VARCHAR(190)  NOT NULL UNIQUE,
  password_hash VARCHAR(255)  NOT NULL,
  plan          ENUM('free','pro') NOT NULL DEFAULT 'free',
  onboarded     BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ── Preferences (one row per user) ───────────────────────
CREATE TABLE IF NOT EXISTS preferences (
  user_id             CHAR(36) PRIMARY KEY,
  wake_phrase         VARCHAR(60)  NOT NULL DEFAULT 'Hey SACHIN',
  response_length     ENUM('short','balanced','detailed') NOT NULL DEFAULT 'balanced',
  response_mode       ENUM('voice','text','smart') NOT NULL DEFAULT 'smart',
  primary_use         ENUM('study','coding','productivity','daily','conversation','everything') NOT NULL DEFAULT 'everything',
  memory_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  voice_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  tts_voice           VARCHAR(60) DEFAULT NULL,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ── Conversations ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id          CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  user_id     CHAR(36)     NOT NULL,
  title       VARCHAR(160) NOT NULL DEFAULT 'New conversation',
  mode        ENUM('friend','teacher','coding','coach','daily') NOT NULL DEFAULT 'friend',
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ── Messages ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  conversation_id CHAR(36) NOT NULL,
  role            ENUM('user','assistant','system') NOT NULL,
  content         TEXT NOT NULL,
  input_type      ENUM('voice','text') NOT NULL DEFAULT 'text',
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  INDEX idx_conversation_created (conversation_id, created_at)
);

-- ── Memory Vault ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memories (
  id          CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  user_id     CHAR(36)    NOT NULL,
  category    ENUM('goal','learning','project','preference','plan','instruction','context','behaviour') NOT NULL,
  content     VARCHAR(500) NOT NULL,
  source      ENUM('user_explicit','sachin_suggested') NOT NULL DEFAULT 'sachin_suggested',
  approved    BOOLEAN     NOT NULL DEFAULT TRUE,
  pinned      BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_category (user_id, category)
);

-- ── Goals (structured, surfaced on the dashboard) ────────
CREATE TABLE IF NOT EXISTS goals (
  id          CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  user_id     CHAR(36)    NOT NULL,
  title       VARCHAR(200) NOT NULL,
  due_date    DATE        DEFAULT NULL,
  status      ENUM('active','done','dropped') NOT NULL DEFAULT 'active',
  created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ── Lightweight metering for the free voice allowance ─────
-- Stores counts only, never speech transcripts or audio.
CREATE TABLE IF NOT EXISTS daily_voice_usage (
  user_id     CHAR(36) NOT NULL,
  usage_date  DATE NOT NULL,
  turns       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, usage_date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS voice_reservations (
  id                CHAR(36) PRIMARY KEY,
  user_id           CHAR(36) NOT NULL,
  transcript_hash   CHAR(64) NOT NULL,
  quota_charged     BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at        DATETIME NOT NULL,
  used_at           DATETIME DEFAULT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_voice_reservations_expiry (expires_at)
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_id VARCHAR(120) PRIMARY KEY,
  applied_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
