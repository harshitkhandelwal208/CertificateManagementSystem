using Microsoft.Data.Sqlite;
using System.Data.Common;
using Npgsql;
using CertificatePlatform.Persistence;
using Microsoft.Extensions.Options;
using CertificateEngine.Configuration;

namespace CertificateEngine.Infrastructure.Persistence;

public sealed class CertificateDatabase
{
    private readonly string _connectionString;
    public bool IsPostgres { get; }

    public CertificateDatabase(IOptions<PlatformOptions> options)
    {
        // Resolve relative runtime data beside the process working directory, not the
        // single-file extraction directory. This keeps the engine and verifier's shared
        // data path predictable when distributed as standalone executables.
        if (Path.IsPathRooted(options.Value.DataDirectory))
        {
            DataDirectory = options.Value.DataDirectory;
        }
        else
        {
            var candidates = new[]
            {
                Path.GetFullPath(Path.Combine("..", "..", options.Value.DataDirectory)),
                Path.GetFullPath(Path.Combine("..", options.Value.DataDirectory)),
                Path.GetFullPath(options.Value.DataDirectory)
            };
            DataDirectory = candidates.FirstOrDefault(Directory.Exists) ?? candidates.Last();
        }
        Directory.CreateDirectory(DataDirectory);

        var databasePath = Path.Combine(DataDirectory, "certificates.db");
        var postgres = DatabaseProvider.PostgreSqlConnectionString();
        IsPostgres = postgres is not null;
        _connectionString = postgres ?? new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared,
            ForeignKeys = true,
            Pooling = true,
            DefaultTimeout = 10
        }.ToString();
    }

    public string DataDirectory { get; }

    public async Task<DbConnection> OpenConnectionAsync(CancellationToken cancellationToken)
    {
        DbConnection connection = IsPostgres ? new NpgsqlConnection(_connectionString) : new SqliteConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        return connection;
    }

    public async Task InitializeAsync(CancellationToken cancellationToken)
    {
        await using var connection = await OpenConnectionAsync(cancellationToken);
        await using var transaction = IsPostgres ? await connection.BeginWriteAsync(cancellationToken) : null;
        var command = connection.CreateCommand();
        command.Transaction = transaction;
        if (IsPostgres)
        {
            command.CommandText = "CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY); SELECT COUNT(*) FROM schema_migrations WHERE version = 1;";
            var migrated = Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken), System.Globalization.CultureInfo.InvariantCulture);
            if (migrated > 0)
            {
                await transaction!.CommitAsync(cancellationToken);
                return;
            }
        }
        command.CommandText = """
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = FULL;
            PRAGMA foreign_keys = ON;
            PRAGMA busy_timeout = 10000;

            CREATE TABLE IF NOT EXISTS certificates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                issuance_key TEXT NOT NULL UNIQUE,
                public_id TEXT NOT NULL UNIQUE,
                certificate_number TEXT NOT NULL UNIQUE,
                event_id TEXT NOT NULL,
                event_name TEXT NOT NULL,
                source_id TEXT NOT NULL,
                source_hash TEXT NOT NULL,
                participant_name TEXT NOT NULL,
                participant_email TEXT NULL,
                participant_phone TEXT NULL,
                template_id TEXT NOT NULL,
                source_row_number INTEGER NOT NULL,
                status TEXT NOT NULL,
                artifact_path TEXT NULL,
                artifact_sha256 TEXT NULL,
                signer_thumbprint TEXT NULL,
                created_at TEXT NOT NULL,
                issued_at TEXT NULL,
                revoked_at TEXT NULL,
                revocation_reason TEXT NULL
            );

            CREATE INDEX IF NOT EXISTS ix_certificates_event_source
                ON certificates(event_id, source_id);

            CREATE TABLE IF NOT EXISTS deliveries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                certificate_id INTEGER NOT NULL,
                channel TEXT NOT NULL,
                destination TEXT NOT NULL,
                status TEXT NOT NULL,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                next_attempt_at TEXT NOT NULL,
                provider_message_id TEXT NULL,
                last_error TEXT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(certificate_id) REFERENCES certificates(id),
                UNIQUE(certificate_id, channel, destination)
            );

            CREATE INDEX IF NOT EXISTS ix_deliveries_due
                ON deliveries(status, next_attempt_at);

            CREATE TABLE IF NOT EXISTS audit_events (
                sequence INTEGER PRIMARY KEY,
                previous_hash TEXT NOT NULL,
                event_hash TEXT NOT NULL UNIQUE,
                occurred_at TEXT NOT NULL,
                event_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                payload TEXT NOT NULL
            );

            CREATE TRIGGER IF NOT EXISTS audit_events_no_update
            BEFORE UPDATE ON audit_events
            BEGIN
                SELECT RAISE(ABORT, 'audit events are append-only');
            END;

            CREATE TRIGGER IF NOT EXISTS audit_events_no_delete
            BEFORE DELETE ON audit_events
            BEGIN
                SELECT RAISE(ABORT, 'audit events are append-only');
            END;

            CREATE TABLE IF NOT EXISTS auth_sessions (
                token_hash TEXT PRIMARY KEY,
                expires_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_auth_sessions_expiry ON auth_sessions(expires_at);
            CREATE TABLE IF NOT EXISTS auth_attempts (
                key_hash TEXT PRIMARY KEY,
                attempts INTEGER NOT NULL,
                window_start TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS events (
                event_id TEXT PRIMARY KEY,
                event_name TEXT NOT NULL,
                template_id TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS ix_events_casefold ON events(lower(event_id));

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'admin',
                created_at TEXT NOT NULL
            );
            """;
        if (IsPostgres)
        {
            command.CommandText = System.Text.RegularExpressions.Regex.Replace(command.CommandText, @"PRAGMA[^;]+;", "");
            command.CommandText = System.Text.RegularExpressions.Regex.Replace(command.CommandText, @"CREATE TRIGGER IF NOT EXISTS audit_events_no_(?:update|delete)[\s\S]*?END;", "");
            command.CommandText = command.CommandText.Replace("INTEGER PRIMARY KEY AUTOINCREMENT", "BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY")
                .Replace("certificate_id INTEGER", "certificate_id BIGINT")
                .Replace("sequence INTEGER PRIMARY KEY", "sequence BIGINT PRIMARY KEY");
            command.CommandText += """
                CREATE TABLE IF NOT EXISTS runtime_files (
                    path TEXT PRIMARY KEY,
                    content BYTEA NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS events (
                    event_id TEXT PRIMARY KEY,
                    event_name TEXT NOT NULL,
                    template_id TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS ix_events_casefold ON events(lower(event_id));
                CREATE OR REPLACE FUNCTION prevent_audit_change() RETURNS trigger AS $$
                BEGIN RAISE EXCEPTION 'audit events are append-only'; END; $$ LANGUAGE plpgsql;
                DROP TRIGGER IF EXISTS audit_events_no_change ON audit_events;
                CREATE TRIGGER audit_events_no_change BEFORE UPDATE OR DELETE ON audit_events
                    FOR EACH ROW EXECUTE FUNCTION prevent_audit_change();
                """;
        }
        await command.ExecuteNonQueryAsync(cancellationToken);
        if (transaction is not null)
        {
            command.CommandText = "INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING";
            await command.ExecuteNonQueryAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
    }
    public async Task StoreFileAsync(string relativePath, byte[] content, CancellationToken ct)
    {
        if (!IsPostgres) return;
        await using var connection = await OpenConnectionAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = "INSERT INTO runtime_files(path, content, updated_at) VALUES (@path, @content, @now) ON CONFLICT(path) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at";
        command.Parameters.AddWithValue("@path", relativePath.Replace('\\', '/'));
        command.Parameters.AddWithValue("@content", content);
        command.Parameters.AddWithValue("@now", DateTimeOffset.UtcNow.ToString("O", System.Globalization.CultureInfo.InvariantCulture));
        await command.ExecuteNonQueryAsync(ct);
    }

    public async Task<byte[]?> ReadFileAsync(string relativePath, CancellationToken ct)
    {
        if (!IsPostgres)
        {
            var local = Path.GetFullPath(Path.Combine(DataDirectory, relativePath));
            if (!local.StartsWith(Path.GetFullPath(DataDirectory) + Path.DirectorySeparatorChar, StringComparison.Ordinal)) throw new InvalidOperationException("Invalid artifact path.");
            return File.Exists(local) ? await File.ReadAllBytesAsync(local, ct) : null;
        }
        await using var connection = await OpenConnectionAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT content FROM runtime_files WHERE path = @path";
        command.Parameters.AddWithValue("@path", relativePath.Replace('\\', '/'));
        return await command.ExecuteScalarAsync(ct) as byte[];
    }

    public void RestoreTemplate(string templateId)
    {
        if (!IsPostgres || !templateId.StartsWith("custom-", StringComparison.Ordinal)) return;
        if (templateId.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not ('-' or '_'))) throw new InvalidOperationException("Invalid template ID.");
        foreach (var extension in new[] { ".pdf", ".json" })
        {
            var relative = $"templates/{templateId}{extension}";
            var bytes = ReadFileAsync(relative, CancellationToken.None).GetAwaiter().GetResult();
            if (bytes is null) continue;
            var local = Path.Combine(DataDirectory, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(local)!);
            // Write atomically; concurrent issue workers can restore the same template.
            var temporary = local + "." + Guid.NewGuid().ToString("N");
            File.WriteAllBytes(temporary, bytes);
            File.Move(temporary, local, true);
        }
    }
}
