using CertificateEngine.Configuration;
using CertificateEngine.Infrastructure.Persistence;
using Microsoft.Extensions.Options;
using Xunit;

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
        await database.StoreFileAsync("templates/integration-check.pdf", [1, 2, 3], CancellationToken.None);
        Assert.Equal(new byte[] { 1, 2, 3 }, await database.ReadFileAsync("templates/integration-check.pdf", CancellationToken.None));
        await using var connection = await database.OpenConnectionAsync(CancellationToken.None);
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM certificates";
        Assert.Equal(0L, Convert.ToInt64(await command.ExecuteScalarAsync(CancellationToken.None), System.Globalization.CultureInfo.InvariantCulture));
    }
}
