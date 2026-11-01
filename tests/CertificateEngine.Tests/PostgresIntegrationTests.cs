using CertificateEngine.Configuration;
using CertificateEngine.Infrastructure.Persistence;
using Microsoft.Extensions.Options;
using Xunit;
using System.Data.Common;

namespace CertificateEngine.Tests;

public sealed class PostgresIntegrationTests
{
    [Fact]
    public async Task InitializesNeonCompatibleSchemaAndPersistsRuntimeFile()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("DATABASE_URL"))) return;
        var database = new CertificateDatabase(Options.Create(new PlatformOptions { DataDirectory = Path.GetTempPath() }));
        Assert.True(database.IsPostgres);
        await database.InitializeAsync(CancellationToken.None);
        var path = $"templates/integration-check-{Guid.NewGuid():N}.pdf";
        try
        {
            await database.StoreFileAsync(path, [1, 2, 3], CancellationToken.None);
            Assert.Equal(new byte[] { 1, 2, 3 }, await database.ReadFileAsync(path, CancellationToken.None));
            await using var connection = await database.OpenConnectionAsync(CancellationToken.None);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT to_regclass('public.certificates') IS NOT NULL";
            Assert.True(Convert.ToBoolean(await command.ExecuteScalarAsync(CancellationToken.None), System.Globalization.CultureInfo.InvariantCulture));
            command.CommandText = "DELETE FROM runtime_files WHERE path = @path";
            DbParameter parameter = command.CreateParameter();
            parameter.ParameterName = "@path";
            parameter.Value = path;
            command.Parameters.Add(parameter);
            await command.ExecuteNonQueryAsync(CancellationToken.None);
        }
        finally
        {
            await using var connection = await database.OpenConnectionAsync(CancellationToken.None);
            await using var command = connection.CreateCommand();
            command.CommandText = "DELETE FROM runtime_files WHERE path = @path";
            DbParameter parameter = command.CreateParameter();
            parameter.ParameterName = "@path";
            parameter.Value = path;
            command.Parameters.Add(parameter);
            await command.ExecuteNonQueryAsync(CancellationToken.None);
        }
    }
}
