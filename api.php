<?php
declare(strict_types=1);

const JSON_FLAGS = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE;

function respond(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_FLAGS);
    exit;
}

function request_data(): array
{
    $raw = file_get_contents('php://input');
    $data = json_decode($raw ?: '{}', true);
    return is_array($data) ? $data : [];
}

function require_user(): int
{
    if (!isset($_SESSION['user_id'])) {
        respond(['error' => 'Please sign in to continue.'], 401);
    }
    return (int) $_SESSION['user_id'];
}

function verify_csrf(): void
{
    $provided = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($provided) || !hash_equals($_SESSION['csrf_token'] ?? '', $provided)) {
        respond(['error' => 'Session expired. Refresh and try again.'], 419);
    }
}

function positive_number(mixed $value, string $label, bool $allow_zero = false): float
{
    if (!is_numeric($value)) {
        respond(['error' => "$label must be a number."], 422);
    }
    $number = (float) $value;
    if (!is_finite($number) || ($allow_zero ? $number < 0 : $number <= 0)) {
        respond(['error' => "$label must be " . ($allow_zero ? 'zero or greater.' : 'greater than zero.')], 422);
    }
    return $number;
}

function account_belongs_to_user(PDO $db, int $account_id, int $user_id): bool
{
    $statement = $db->prepare('SELECT id FROM trading_accounts WHERE id = :id AND user_id = :user_id');
    $statement->execute(['id' => $account_id, 'user_id' => $user_id]);
    return (bool) $statement->fetchColumn();
}

try {
    $config_path = __DIR__ . '/config.php';
    if (!is_file($config_path)) {
        respond(['error' => 'Server setup is incomplete. Add database settings from config.example.php.'], 503);
    }
    $config = require $config_path;
    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $config['db_host'], $config['db_name']);
    $db = new PDO($dsn, $config['db_user'], $config['db_password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    session_name('tradersheild_session');
    session_set_cookie_params([
        'httponly' => true,
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'samesite' => 'Lax',
        'path' => '/',
    ]);
    session_start();

    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $action = $_GET['action'] ?? '';

    if ($method === 'GET' && $action === 'csrf') {
        $_SESSION['csrf_token'] ??= bin2hex(random_bytes(32));
        respond(['csrf_token' => $_SESSION['csrf_token']]);
    }

    if ($method === 'POST') {
        verify_csrf();
        $input = request_data();

        if ($action === 'register' || $action === 'login') {
            $email = strtolower(trim((string) ($input['email'] ?? '')));
            $password = (string) ($input['password'] ?? '');
            if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254) {
                respond(['error' => 'Enter a valid email address.'], 422);
            }
            if (strlen($password) < 12 || strlen($password) > 72) {
                respond(['error' => 'Password must be between 12 and 72 bytes.'], 422);
            }

            if ($action === 'register') {
                $statement = $db->prepare('INSERT INTO users (email, password_hash) VALUES (:email, :password_hash)');
                try {
                    $statement->execute(['email' => $email, 'password_hash' => password_hash($password, PASSWORD_DEFAULT)]);
                } catch (PDOException $exception) {
                    if ($exception->getCode() === '23000') {
                        respond(['error' => 'An account with that email already exists.'], 409);
                    }
                    throw $exception;
                }
                $user_id = (int) $db->lastInsertId();
            } else {
                $statement = $db->prepare('SELECT id, password_hash FROM users WHERE email = :email LIMIT 1');
                $statement->execute(['email' => $email]);
                $user = $statement->fetch();
                if (!$user || !password_verify($password, $user['password_hash'])) {
                    respond(['error' => 'Email or password is incorrect.'], 401);
                }
                $user_id = (int) $user['id'];
            }

            session_regenerate_id(true);
            $_SESSION['user_id'] = $user_id;
            $_SESSION['email'] = $email;
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
            respond(['user' => ['email' => $email], 'csrf_token' => $_SESSION['csrf_token']]);
        }

        if ($action === 'logout') {
            require_user();
            $_SESSION = [];
            session_destroy();
            respond(['ok' => true]);
        }

        $user_id = require_user();

        if ($action === 'account-create') {
            $name = trim((string) ($input['name'] ?? ''));
            $broker = trim((string) ($input['broker'] ?? 'Manual'));
            $platform = trim((string) ($input['platform'] ?? 'Manual'));
            $type = trim((string) ($input['type'] ?? 'Demo'));
            $balance = positive_number($input['balance'] ?? null, 'Starting balance', true);
            if ($name === '' || strlen($name) > 100 || strlen($broker) > 100 || strlen($platform) > 60 || !in_array($type, ['Live', 'Demo', 'Prop firm'], true)) {
                respond(['error' => 'Check the account name, broker, platform, and account type.'], 422);
            }
            $statement = $db->prepare('INSERT INTO trading_accounts (user_id, name, broker, platform, account_type, starting_balance) VALUES (:user_id, :name, :broker, :platform, :type, :balance)');
            $statement->execute(['user_id' => $user_id, 'name' => $name, 'broker' => $broker, 'platform' => $platform, 'type' => $type, 'balance' => $balance]);
            respond(['id' => (int) $db->lastInsertId()]);
        }

        if ($action === 'account-delete') {
            $account_id = filter_var($input['id'] ?? null, FILTER_VALIDATE_INT);
            if (!$account_id || !account_belongs_to_user($db, (int) $account_id, $user_id)) {
                respond(['error' => 'Account not found.'], 404);
            }
            $statement = $db->prepare('DELETE FROM trading_accounts WHERE id = :id AND user_id = :user_id');
            $statement->execute(['id' => $account_id, 'user_id' => $user_id]);
            respond(['ok' => true]);
        }

        if ($action === 'trade-create' || $action === 'trade-update') {
            $trade_id = filter_var($input['id'] ?? null, FILTER_VALIDATE_INT);
            $account_id = filter_var($input['account_id'] ?? null, FILTER_VALIDATE_INT);
            $symbol = strtoupper(trim((string) ($input['symbol'] ?? '')));
            $side = (string) ($input['side'] ?? '');
            $entry = positive_number($input['entry'] ?? null, 'Entry');
            $exit = positive_number($input['exit'] ?? null, 'Exit');
            $lots = positive_number($input['lots'] ?? null, 'Lots');
            if (!is_numeric($input['pnl'] ?? null)) {
                respond(['error' => 'Profit/Loss must be a number.'], 422);
            }
            $pnl = (float) $input['pnl'];
            $traded_at = (string) ($input['traded_at'] ?? date('Y-m-d'));
            $notes = trim((string) ($input['notes'] ?? ''));
            $date = DateTime::createFromFormat('Y-m-d', $traded_at);
            if (!$account_id || !account_belongs_to_user($db, (int) $account_id, $user_id)) {
                respond(['error' => 'Choose one of your accounts.'], 422);
            }
            if (!preg_match('/^[A-Z0-9._-]{2,20}$/', $symbol) || !in_array($side, ['Buy', 'Sell'], true) || !$date || $date->format('Y-m-d') !== $traded_at || !is_finite($pnl) || strlen($notes) > 2000) {
                respond(['error' => 'Check the trade fields and try again.'], 422);
            }
            $values = ['user_id' => $user_id, 'account_id' => $account_id, 'symbol' => $symbol, 'side' => $side, 'entry' => $entry, 'exit' => $exit, 'lots' => $lots, 'pnl' => $pnl, 'traded_at' => $traded_at, 'notes' => $notes];
            if ($action === 'trade-update') {
                if (!$trade_id) {
                    respond(['error' => 'Trade not found.'], 404);
                }
                $values['id'] = $trade_id;
                $statement = $db->prepare('UPDATE trades SET account_id=:account_id, symbol=:symbol, side=:side, entry_price=:entry, exit_price=:exit, lots=:lots, pnl=:pnl, traded_at=:traded_at, notes=:notes WHERE id=:id AND user_id=:user_id');
                $statement->execute($values);
                if ($statement->rowCount() === 0) {
                    $check = $db->prepare('SELECT id FROM trades WHERE id=:id AND user_id=:user_id');
                    $check->execute(['id' => $trade_id, 'user_id' => $user_id]);
                    if (!$check->fetchColumn()) {
                        respond(['error' => 'Trade not found.'], 404);
                    }
                }
                respond(['ok' => true]);
            }
            $statement = $db->prepare('INSERT INTO trades (user_id, account_id, symbol, side, entry_price, exit_price, lots, pnl, traded_at, notes) VALUES (:user_id, :account_id, :symbol, :side, :entry, :exit, :lots, :pnl, :traded_at, :notes)');
            $statement->execute($values);
            respond(['id' => (int) $db->lastInsertId()]);
        }

        if ($action === 'trade-delete') {
            $trade_id = filter_var($input['id'] ?? null, FILTER_VALIDATE_INT);
            if (!$trade_id) {
                respond(['error' => 'Trade not found.'], 404);
            }
            $statement = $db->prepare('DELETE FROM trades WHERE id=:id AND user_id=:user_id');
            $statement->execute(['id' => $trade_id, 'user_id' => $user_id]);
            if (!$statement->rowCount()) {
                respond(['error' => 'Trade not found.'], 404);
            }
            respond(['ok' => true]);
        }

        if ($action === 'risk-save') {
            $daily_loss = positive_number($input['daily_loss_percent'] ?? null, 'Daily loss limit');
            $drawdown = positive_number($input['max_drawdown_percent'] ?? null, 'Maximum drawdown');
            $exposure = positive_number($input['exposure_percent'] ?? null, 'Exposure limit');
            if ($daily_loss > 100 || $drawdown > 100 || $exposure > 100) {
                respond(['error' => 'Risk limits must not exceed 100%.'], 422);
            }
            $today = gmdate('Y-m-d');
            $db->beginTransaction();
            $update = $db->prepare('UPDATE risk_settings SET daily_loss_percent=:daily_loss, max_drawdown_percent=:drawdown, exposure_percent=:exposure, last_changed_date=:today WHERE user_id=:user_id AND (last_changed_date IS NULL OR last_changed_date < :today)');
            $update->execute(['daily_loss' => $daily_loss, 'drawdown' => $drawdown, 'exposure' => $exposure, 'today' => $today, 'user_id' => $user_id]);
            if ($update->rowCount() === 0) {
                $check = $db->prepare('SELECT last_changed_date FROM risk_settings WHERE user_id=:user_id');
                $check->execute(['user_id' => $user_id]);
                $last_changed = $check->fetchColumn();
                if ($last_changed !== false) {
                    $db->rollBack();
                    respond(['error' => 'Risk settings can only be changed once per UTC day. Try again after 00:00 UTC tomorrow.', 'next_change_utc' => gmdate('Y-m-d\TH:i:s\Z', strtotime('tomorrow UTC'))], 429);
                }
                try {
                    $insert = $db->prepare('INSERT INTO risk_settings (user_id, daily_loss_percent, max_drawdown_percent, exposure_percent, last_changed_date) VALUES (:user_id, :daily_loss, :drawdown, :exposure, :today)');
                    $insert->execute(['user_id' => $user_id, 'daily_loss' => $daily_loss, 'drawdown' => $drawdown, 'exposure' => $exposure, 'today' => $today]);
                } catch (PDOException $exception) {
                    $db->rollBack();
                    if ($exception->getCode() === '23000' || $exception->getCode() === '40001') {
                        respond(['error' => 'Risk settings can only be changed once per UTC day. Try again after 00:00 UTC tomorrow.'], 429);
                    }
                    throw $exception;
                }
            }
            $db->commit();
            respond(['ok' => true, 'last_changed_date' => $today, 'next_change_utc' => gmdate('Y-m-d\TH:i:s\Z', strtotime('tomorrow UTC'))]);
        }

        respond(['error' => 'Unknown action.'], 404);
    }

    if ($method === 'GET' && $action === 'state') {
        $user_id = require_user();
        $accounts_query = $db->prepare('SELECT id, name, broker, platform, account_type AS type, starting_balance AS balance FROM trading_accounts WHERE user_id=:user_id ORDER BY created_at DESC');
        $accounts_query->execute(['user_id' => $user_id]);
        $trades_query = $db->prepare('SELECT t.id, t.account_id, a.name AS account, t.symbol, t.side, t.entry_price AS entry, t.exit_price AS exit, t.lots, t.pnl, t.traded_at AS date, t.notes FROM trades t JOIN trading_accounts a ON a.id=t.account_id WHERE t.user_id=:user_id ORDER BY t.traded_at DESC, t.id DESC LIMIT 500');
        $trades_query->execute(['user_id' => $user_id]);
        $risk_query = $db->prepare('SELECT daily_loss_percent, max_drawdown_percent, exposure_percent, last_changed_date FROM risk_settings WHERE user_id=:user_id');
        $risk_query->execute(['user_id' => $user_id]);
        $risk = $risk_query->fetch() ?: ['daily_loss_percent' => 2, 'max_drawdown_percent' => 12, 'exposure_percent' => 4.5, 'last_changed_date' => null];
        $trades = $trades_query->fetchAll();
        $stats_query = $db->prepare('SELECT COUNT(*) AS total_trades, COALESCE(SUM(pnl > 0), 0) AS wins, COALESCE(SUM(pnl), 0) AS total_pnl FROM trades WHERE user_id=:user_id');
        $stats_query->execute(['user_id' => $user_id]);
        $aggregate = $stats_query->fetch();
        $total_trades = (int) $aggregate['total_trades'];
        respond([
            'user' => ['email' => $_SESSION['email'] ?? ''],
            'accounts' => $accounts_query->fetchAll(),
            'trades' => $trades,
            'risk' => $risk,
            'stats' => ['total_trades' => $total_trades, 'win_rate' => $total_trades ? round((int) $aggregate['wins'] / $total_trades * 100, 1) : 0, 'pnl' => round((float) $aggregate['total_pnl'], 2)],
            'csrf_token' => $_SESSION['csrf_token'],
        ]);
    }

    if ($method === 'GET' && $action === 'me') {
        require_user();
        respond(['user' => ['email' => $_SESSION['email'] ?? ''], 'csrf_token' => $_SESSION['csrf_token']]);
    }

    respond(['error' => 'Unknown action.'], 404);
} catch (Throwable $exception) {
    if (isset($db) && $db instanceof PDO && $db->inTransaction()) {
        $db->rollBack();
    }
    error_log($exception->__toString());
    respond(['error' => 'A server error occurred. Check the deployment configuration and server log.'], 500);
}