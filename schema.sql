CREATE TABLE users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    email VARCHAR(254) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY users_email_unique (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE trading_accounts (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(100) NOT NULL,
    broker VARCHAR(100) NOT NULL DEFAULT 'Manual',
    platform VARCHAR(60) NOT NULL DEFAULT 'Manual',
    account_type ENUM('Live', 'Demo', 'Prop firm') NOT NULL DEFAULT 'Demo',
    starting_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY account_owner_unique (id, user_id),
    KEY accounts_by_user (user_id, created_at),
    CONSTRAINT accounts_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE trades (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    account_id BIGINT UNSIGNED NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    side ENUM('Buy', 'Sell') NOT NULL,
    entry_price DECIMAL(20,8) NOT NULL,
    exit_price DECIMAL(20,8) NOT NULL,
    lots DECIMAL(14,4) NOT NULL,
    pnl DECIMAL(15,2) NOT NULL DEFAULT 0,
    traded_at DATE NOT NULL,
    notes VARCHAR(2000) NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY trades_by_user_date (user_id, traded_at, id),
    CONSTRAINT trades_account_owner_fk FOREIGN KEY (account_id, user_id) REFERENCES trading_accounts (id, user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE risk_settings (
    user_id BIGINT UNSIGNED NOT NULL,
    daily_loss_percent DECIMAL(5,2) NOT NULL DEFAULT 2.00,
    max_drawdown_percent DECIMAL(5,2) NOT NULL DEFAULT 12.00,
    exposure_percent DECIMAL(5,2) NOT NULL DEFAULT 4.50,
    last_changed_date DATE NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    CONSTRAINT risk_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;