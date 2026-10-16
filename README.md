# TraderSheild Journal

Hostinger-compatible PHP/MySQL foundation for a manual trading journal. Broker connections, real payment processing, email verification, and external market predictions are not implemented.

Opening `index.html` directly from disk enables a browser-session preview for signup and journal flows. Preview users and records are simulated, stay in the current browser session, and are not sent to the PHP API.

## Requirements

- PHP 8.1 or later with PDO MySQL enabled
- MySQL 8.0 or compatible MariaDB
- HTTPS enabled for the live domain

## Hostinger deployment

1. Create a MySQL database and database user in hPanel, and grant the user access to the database.
2. Import `schema.sql` into that database using phpMyAdmin.
	If you already created the users table, run this migration once:

	```sql
	ALTER TABLE users ADD COLUMN display_name VARCHAR(80) NOT NULL DEFAULT '';
	ALTER TABLE users ADD COLUMN timezone VARCHAR(64) NOT NULL DEFAULT 'UTC';
	ALTER TABLE users ADD COLUMN base_currency CHAR(3) NOT NULL DEFAULT 'USD';
	```
	If you imported an earlier schema already, run `ALTER TABLE risk_settings ADD COLUMN last_changed_date DATE NULL;` once before deploying this version.
3. Copy `config.example.php` to `config.php` in the deployed application directory. Fill in the database name, user, and password in `config.php`. Do not commit `config.php`.
4. Upload the application files to the domain's `public_html` directory, or point the domain document root at the application directory.
5. Enable the domain's SSL certificate before testing registration and sign-in.
6. Open the domain root. `index.html` serves the app and calls the PHP API in `api.php`.

The local workspace does not contain live Hostinger credentials. A database must be created and configured in hPanel before authentication and saved records can work.

## Features in this release

- Email and password registration/login using PHP sessions and password hashing
- User-owned profile, manual accounts, trade journal records, dashboard totals, saved risk preferences, and date-range P/L analytics
- Global search across navigation pages and the signed-in user's accounts/trades
- MySQL prepared statements, CSRF token checks on mutations, and user ownership checks

Risk settings are stored for review; they do not block or execute trades. Account entries are manual and never connect to a broker. The game and other preview-only pages are simulations. Pricing buttons do not charge money.