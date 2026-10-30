using System.Data.Common;
using Microsoft.Data.Sqlite;
using Npgsql;

namespace CertificatePlatform.Persistence;

public static class DatabaseProvider
{
    public static string? PostgreSqlConnectionString()
    {
        var value = Environment.GetEnvironmentVariable("DATABASE_URL");
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme is not ("postgres" or "postgresql"))
            throw new InvalidOperationException("DATABASE_URL must be a PostgreSQL connection URL.");
        var credentials = uri.UserInfo.Split(':', 2);
        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.Port > 0 ? uri.Port : 5432,
            Username = Uri.UnescapeDataString(credentials[0]),
            Password = credentials.Length > 1 ? Uri.UnescapeDataString(credentials[1]) : "",
            Database = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/')),
            SslMode = uri.IsLoopback ? SslMode.Disable : SslMode.VerifyFull,
            MaxPoolSize = 5,
            Timeout = 20,
            CommandTimeout = 30,
            IncludeErrorDetail = false
        };
        return builder.ConnectionString;
    }

    public static void AddWithValue(this DbParameterCollection parameters, string name, object value)
    {
        DbParameter parameter = parameters is NpgsqlParameterCollection
            ? new NpgsqlParameter { ParameterName = name, Value = value }
            : new SqliteParameter(name, value);
        parameters.Add(parameter);
    }

    public static async Task<DbTransaction> BeginWriteAsync(this DbConnection connection, CancellationToken ct)
    {
        if (connection is SqliteConnection sqlite) return sqlite.BeginTransaction(deferred: false);
        var transaction = await connection.BeginTransactionAsync(ct);
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT pg_advisory_xact_lock(73421001)";
        await command.ExecuteNonQueryAsync(ct);
        return transaction;
    }
}
