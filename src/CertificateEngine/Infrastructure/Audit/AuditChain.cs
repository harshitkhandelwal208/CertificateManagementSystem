using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Data.Common;
using CertificatePlatform.Persistence;

namespace CertificateEngine.Infrastructure.Audit;

public static class AuditChain
{
    public const string GenesisHash = "GENESIS";

    public static string Canonicalize(IReadOnlyDictionary<string, string?> values)
    {
        var ordered = new SortedDictionary<string, string?>(StringComparer.Ordinal);
        foreach (var pair in values)
        {
            ordered.Add(pair.Key, pair.Value);
        }
        return JsonSerializer.Serialize(new Dictionary<string, string?>(ordered));
    }

    public static string ComputeHash(
        long sequence,
        string previousHash,
        DateTimeOffset occurredAt,
        string eventType,
        string entityId,
        string canonicalPayload)
    {
        var canonical = string.Join('\n',
            "audit-v1",
            sequence.ToString(CultureInfo.InvariantCulture),
            previousHash,
            occurredAt.UtcDateTime.ToString("O", CultureInfo.InvariantCulture),
            Prefix(eventType),
            Prefix(entityId),
            Prefix(canonicalPayload));

        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
    }

    public static async Task AppendAsync(
        DbConnection connection,
        DbTransaction transaction,
        string eventType,
        string entityId,
        IReadOnlyDictionary<string, string?> payload,
        CancellationToken cancellationToken)
    {
        var headCommand = connection.CreateCommand();
        headCommand.Transaction = transaction;
        headCommand.CommandText = "SELECT sequence, event_hash FROM audit_events ORDER BY sequence DESC LIMIT 1;";

        long sequence = 1;
        var previousHash = GenesisHash;
        await using (var reader = await headCommand.ExecuteReaderAsync(cancellationToken))
        {
            if (await reader.ReadAsync(cancellationToken))
            {
                sequence = reader.GetInt64(0) + 1;
                previousHash = reader.GetString(1);
            }
        }

        var occurredAt = DateTimeOffset.UtcNow;
        var canonicalPayload = Canonicalize(payload);
        var eventHash = ComputeHash(sequence, previousHash, occurredAt, eventType, entityId, canonicalPayload);

        var insert = connection.CreateCommand();
        insert.Transaction = transaction;
        insert.CommandText = """
            INSERT INTO audit_events
                (sequence, previous_hash, event_hash, occurred_at, event_type, entity_id, payload)
            VALUES
                (@sequence, @previousHash, @eventHash, @occurredAt, @eventType, @entityId, @payload);
            """;
        insert.Parameters.AddWithValue("@sequence", sequence);
        insert.Parameters.AddWithValue("@previousHash", previousHash);
        insert.Parameters.AddWithValue("@eventHash", eventHash);
        insert.Parameters.AddWithValue("@occurredAt", occurredAt.ToString("O", CultureInfo.InvariantCulture));
        insert.Parameters.AddWithValue("@eventType", eventType);
        insert.Parameters.AddWithValue("@entityId", entityId);
        insert.Parameters.AddWithValue("@payload", canonicalPayload);
        await insert.ExecuteNonQueryAsync(cancellationToken);
    }

    public static async Task<AuditVerificationResult> VerifyAsync(
        DbConnection connection,
        CancellationToken cancellationToken)
    {
        var command = connection.CreateCommand();
        command.CommandText = """
            SELECT sequence, previous_hash, event_hash, occurred_at, event_type, entity_id, payload
            FROM audit_events
            ORDER BY sequence;
            """;

        var expectedPrevious = GenesisHash;
        long expectedSequence = 1;
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var sequence = reader.GetInt64(0);
            var previousHash = reader.GetString(1);
            var eventHash = reader.GetString(2);
            var occurredAt = DateTimeOffset.Parse(reader.GetString(3), CultureInfo.InvariantCulture);
            var eventType = reader.GetString(4);
            var entityId = reader.GetString(5);
            var payload = reader.GetString(6);

            var computedHash = ComputeHash(sequence, previousHash, occurredAt, eventType, entityId, payload);
            if (sequence != expectedSequence
                || !CryptographicOperations.FixedTimeEquals(
                    Encoding.ASCII.GetBytes(previousHash),
                    Encoding.ASCII.GetBytes(expectedPrevious))
                || !CryptographicOperations.FixedTimeEquals(
                    Encoding.ASCII.GetBytes(eventHash),
                    Encoding.ASCII.GetBytes(computedHash)))
            {
                return new AuditVerificationResult(false, sequence, eventHash, "Audit chain mismatch.");
            }

            expectedSequence++;
            expectedPrevious = eventHash;
        }

        return new AuditVerificationResult(true, expectedSequence - 1, expectedPrevious, null);
    }

    private static string Prefix(string value) => $"{Encoding.UTF8.GetByteCount(value)}:{value}";
}

public sealed record AuditVerificationResult(bool IsValid, long EventCount, string HeadHash, string? Error);
