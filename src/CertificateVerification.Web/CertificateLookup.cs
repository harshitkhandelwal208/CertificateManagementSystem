using System.Globalization;
using System.Security.Cryptography;
using System.Security.Cryptography.Pkcs;
using System.Security.Cryptography.X509Certificates;
using Microsoft.Data.Sqlite;
using System.Data.Common;
using Npgsql;
using CertificatePlatform.Persistence;
using Microsoft.Extensions.Options;

namespace CertificateVerification.Web;

public sealed class CertificateLookup(IOptions<VerificationOptions> options)
{
    private readonly VerificationOptions _options = options.Value;

    public async Task<VerifiedCertificate?> FindAsync(string publicId, CancellationToken cancellationToken)
    {
        var dataDirectory = ResolveDataDirectory();
        var postgres = DatabaseProvider.PostgreSqlConnectionString();
        if (postgres is null && !File.Exists(Path.Combine(dataDirectory, "certificates.db"))) return null;
        var builder = new SqliteConnectionStringBuilder { DataSource = Path.Combine(dataDirectory, "certificates.db"), Mode = SqliteOpenMode.ReadOnly };
        await using DbConnection connection = postgres is not null ? new NpgsqlConnection(postgres) : new SqliteConnection(builder.ToString());
        await connection.OpenAsync(cancellationToken);
        var command = connection.CreateCommand();
        command.CommandText = "SELECT public_id, certificate_number, participant_name, event_name, template_id, status, artifact_path, artifact_sha256, issued_at, revoked_at, revocation_reason FROM certificates WHERE public_id = @id LIMIT 1;";
        command.Parameters.AddWithValue("@id", publicId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;
        var record = new VerificationRecord(reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.IsDBNull(4) ? "default" : reader.GetString(4), reader.GetString(5), reader.IsDBNull(6) ? null : reader.GetString(6), reader.IsDBNull(7) ? null : reader.GetString(7), reader.IsDBNull(8) ? null : DateTimeOffset.Parse(reader.GetString(8), CultureInfo.InvariantCulture), reader.IsDBNull(9) ? null : DateTimeOffset.Parse(reader.GetString(9), CultureInfo.InvariantCulture), reader.IsDBNull(10) ? null : reader.GetString(10));
        await reader.DisposeAsync();
        var signatureValid = record.Status == "Issued" && await VerifyArtifactAsync(dataDirectory, record, cancellationToken);
        var status = record.Status == "Revoked" ? "Revoked" : signatureValid ? "Valid" : "Invalid";
        return new VerifiedCertificate(record, status, signatureValid);
    }

    private async Task<bool> VerifyArtifactAsync(string dataDirectory, VerificationRecord record, CancellationToken cancellationToken)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(record.ArtifactPath) || string.IsNullOrWhiteSpace(record.ArtifactSha256)) return false;
            var pdfPath = Path.Combine(dataDirectory, record.ArtifactPath.Replace('/', Path.DirectorySeparatorChar));
            var pdf = await ReadArtifactAsync(dataDirectory, record.ArtifactPath, cancellationToken);
            if (pdf is null) return false;
            if (!CryptographicOperations.FixedTimeEquals(Convert.FromHexString(record.ArtifactSha256), SHA256.HashData(pdf))) return false;
            if (string.IsNullOrWhiteSpace(_options.TrustedRootPath)) return DatabaseProvider.PostgreSqlConnectionString() is null; // unsigned mode is restricted to local SQLite tests
            var p7sPath = pdfPath + ".p7s";
            var signature = await ReadArtifactAsync(dataDirectory, record.ArtifactPath + ".p7s", cancellationToken);
            if (signature is null) return false;
            var cms = new SignedCms(new ContentInfo(pdf), detached: true);
            cms.Decode(signature);
            cms.CheckSignature(verifySignatureOnly: true);
            var signer = cms.SignerInfos.Count == 1 ? cms.SignerInfos[0].Certificate : null;
            if (signer is null) return false;
            using var root = X509Certificate2.CreateFromPem(File.ReadAllText(ResolvePath(_options.TrustedRootPath)));
            using var chain = new X509Chain();
            chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
            chain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
            chain.ChainPolicy.CustomTrustStore.Add(root);
            chain.ChainPolicy.ExtraStore.AddRange(cms.Certificates);
            return chain.Build(signer);
        }
        catch (Exception exception) when (exception is CryptographicException
            or FormatException
            or IOException
            or UnauthorizedAccessException)
        {
            return false;
        }
    }

    private static async Task<byte[]?> ReadArtifactAsync(string dataDirectory, string relativePath, CancellationToken ct)
    {
        var postgres = DatabaseProvider.PostgreSqlConnectionString();
        if (postgres is not null)
        {
            await using var connection = new NpgsqlConnection(postgres);
            await connection.OpenAsync(ct);
            await using var command = connection.CreateCommand();
            command.CommandText = "SELECT content FROM runtime_files WHERE path = @path";
            command.Parameters.AddWithValue("@path", relativePath.Replace('\\', '/'));
            return await command.ExecuteScalarAsync(ct) as byte[];
        }
        var path = Path.GetFullPath(Path.Combine(dataDirectory, relativePath));
        if (!path.StartsWith(Path.GetFullPath(dataDirectory) + Path.DirectorySeparatorChar, StringComparison.Ordinal)) return null;
        return File.Exists(path) ? await File.ReadAllBytesAsync(path, ct) : null;
    }

    private static string ResolvePath(string path)
    {
        if (Path.IsPathRooted(path)) return path;
        var candidates = new[]
        {
            Path.GetFullPath(path),
            Path.GetFullPath(Path.Combine("..", "..", path)),
            Path.GetFullPath(Path.Combine("..", path)),
            Path.GetFullPath(path, AppContext.BaseDirectory),
        };
        foreach (var candidate in candidates)
        {
            if (File.Exists(candidate) || Directory.Exists(candidate))
                return candidate;
        }
        return candidates[0];
    }

    private string ResolveDataDirectory()
    {
        var dataDir = string.IsNullOrWhiteSpace(_options.DataDirectory) ? "data" : _options.DataDirectory;
        if (Path.IsPathRooted(dataDir)) return dataDir;

        var candidates = new[]
        {
            Path.GetFullPath(Path.Combine("..", "..", dataDir)),
            Path.GetFullPath(Path.Combine("..", dataDir)),
            Path.GetFullPath(dataDir),
            Path.GetFullPath(Path.Combine("..", "CertificateEngine", dataDir)),
            Path.Combine(AppContext.BaseDirectory, dataDir),
            Path.GetFullPath("../certificate-engine/data", AppContext.BaseDirectory),
        };
        return candidates.FirstOrDefault(candidate => File.Exists(Path.Combine(candidate, "certificates.db")))
            ?? candidates.FirstOrDefault(Directory.Exists)
            ?? candidates[0];
    }
}

public sealed record VerificationRecord(string PublicId, string CertificateNumber, string ParticipantName, string EventName, string TemplateId, string Status, string? ArtifactPath, string? ArtifactSha256, DateTimeOffset? IssuedAt, DateTimeOffset? RevokedAt, string? RevocationReason);
public sealed record VerifiedCertificate(VerificationRecord Record, string Status, bool SignatureValid);
