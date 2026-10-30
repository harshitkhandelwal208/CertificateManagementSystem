using System.Globalization;
using System.Security.Cryptography;
using CertificateEngine.Api;
using CertificateEngine.Configuration;
using CertificateEngine.Domain;
using CertificateEngine.Infrastructure.Audit;
using System.Data.Common;
using CertificatePlatform.Persistence;

namespace CertificateEngine.Infrastructure.Persistence;

public sealed class CertificateRepository(CertificateDatabase database)
{
    public async Task<(CertificateRecord Certificate, bool Created)> GetOrCreateAsync(
        SheetSubmission submission,
        EventSourceOptions eventOptions,
        CancellationToken cancellationToken)
    {
        var issuanceKey = $"{submission.EventId}:{submission.Participant.SourceId}";
        await using var connection = await database.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginWriteAsync(cancellationToken);

        var existing = await FindByIssuanceKeyAsync(connection, transaction, issuanceKey, cancellationToken);
        if (existing is not null)
        {
            await transaction.CommitAsync(cancellationToken);
            return (existing, false);
        }

        var now = DateTimeOffset.UtcNow;
        var publicId = CreatePublicId();
        var certificateNumber = CreateCertificateNumber(submission.EventId, now);

        var insert = connection.CreateCommand();
        insert.Transaction = transaction;
        insert.CommandText = """
            INSERT INTO certificates
                (issuance_key, public_id, certificate_number, event_id, event_name, source_id,
                 source_hash, participant_name, participant_email, participant_phone, template_id,
                 source_row_number, status, created_at)
            VALUES
                (@issuanceKey, @publicId, @certificateNumber, @eventId, @eventName, @sourceId,
                 @sourceHash, @participantName, @participantEmail, @participantPhone, @templateId,
                 @sourceRowNumber, 'Pending', @createdAt)
            RETURNING id;
            """;
        insert.Parameters.AddWithValue("@issuanceKey", issuanceKey);
        insert.Parameters.AddWithValue("@publicId", publicId);
        insert.Parameters.AddWithValue("@certificateNumber", certificateNumber);
        insert.Parameters.AddWithValue("@eventId", submission.EventId);
        insert.Parameters.AddWithValue("@eventName", submission.EventName);
        insert.Parameters.AddWithValue("@sourceId", submission.Participant.SourceId);
        insert.Parameters.AddWithValue("@sourceHash", submission.SourceHash);
        insert.Parameters.AddWithValue("@participantName", submission.Participant.FullName);
        insert.Parameters.AddWithValue("@participantEmail", (object?)submission.Participant.Email ?? DBNull.Value);
        insert.Parameters.AddWithValue("@participantPhone", (object?)submission.Participant.PhoneNumber ?? DBNull.Value);
        insert.Parameters.AddWithValue("@templateId", eventOptions.TemplateId);
        insert.Parameters.AddWithValue("@sourceRowNumber", submission.RowNumber);
        insert.Parameters.AddWithValue("@createdAt", Format(now));
        var id = Convert.ToInt64(await insert.ExecuteScalarAsync(cancellationToken), CultureInfo.InvariantCulture);

        await AuditChain.AppendAsync(connection, transaction, "certificate.reserved", publicId,
            new Dictionary<string, string?>
            {
                ["certificateNumber"] = certificateNumber,
                ["eventId"] = submission.EventId,
                ["sourceHash"] = submission.SourceHash,
                ["sourceId"] = submission.Participant.SourceId,
                ["templateId"] = eventOptions.TemplateId
            }, cancellationToken);

        await transaction.CommitAsync(cancellationToken);
        var record = new CertificateRecord(
            id, issuanceKey, publicId, certificateNumber, submission.EventId, submission.EventName,
            submission.Participant.SourceId, submission.SourceHash, submission.Participant.FullName,
            submission.Participant.Email, submission.Participant.PhoneNumber, eventOptions.TemplateId,
            submission.RowNumber, CertificateStatus.Pending, null, null, null, now, null, null, null);
        return (record, true);
    }

    public async Task MarkIssuedAsync(
        long certificateId,
        string artifactPath,
        string artifactSha256,
        string signerThumbprint,
        EventSourceOptions eventOptions,
        CancellationToken cancellationToken)
    {
        await using var connection = await database.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginWriteAsync(cancellationToken);
        var certificate = await FindByIdAsync(connection, transaction, certificateId, cancellationToken)
            ?? throw new InvalidOperationException($"Certificate {certificateId} does not exist.");

        if (certificate.Status == CertificateStatus.Issued)
        {
            await transaction.CommitAsync(cancellationToken);
            return;
        }

        if (certificate.Status != CertificateStatus.Pending)
        {
            throw new InvalidOperationException($"Certificate {certificateId} cannot be issued from {certificate.Status}.");
        }

        var now = DateTimeOffset.UtcNow;
        var update = connection.CreateCommand();
        update.Transaction = transaction;
        update.CommandText = """
            UPDATE certificates
            SET status = 'Issued', artifact_path = @artifactPath, artifact_sha256 = @artifactSha256,
                signer_thumbprint = @signerThumbprint, issued_at = @issuedAt
            WHERE id = @id AND status = 'Pending';
            """;
        update.Parameters.AddWithValue("@artifactPath", artifactPath);
        update.Parameters.AddWithValue("@artifactSha256", artifactSha256);
        update.Parameters.AddWithValue("@signerThumbprint", signerThumbprint);
        update.Parameters.AddWithValue("@issuedAt", Format(now));
        update.Parameters.AddWithValue("@id", certificateId);
        await update.ExecuteNonQueryAsync(cancellationToken);

        await AuditChain.AppendAsync(connection, transaction, "certificate.issued", certificate.PublicId,
            new Dictionary<string, string?>
            {
                ["artifactSha256"] = artifactSha256,
                ["certificateNumber"] = certificate.CertificateNumber,
                ["signerThumbprint"] = signerThumbprint
            }, cancellationToken);

        var hasWhatsApp = eventOptions.SendWhatsApp && !string.IsNullOrWhiteSpace(certificate.ParticipantPhone);
        if (hasWhatsApp)
        {
            await InsertDeliveryAsync(connection, transaction, certificateId, DeliveryChannel.WhatsApp,
                certificate.ParticipantPhone!, now, cancellationToken);
        }

        var sendEmailImmediately = eventOptions.SendEmail
            && !string.IsNullOrWhiteSpace(certificate.ParticipantEmail)
            && (!hasWhatsApp || !eventOptions.EmailFallbackForWhatsApp);
        if (sendEmailImmediately)
        {
            await InsertDeliveryAsync(connection, transaction, certificateId, DeliveryChannel.Email,
                certificate.ParticipantEmail!, now, cancellationToken);
        }

        if (!hasWhatsApp
            && eventOptions.EmailFallbackForWhatsApp
            && !string.IsNullOrWhiteSpace(certificate.ParticipantEmail))
        {
            await InsertDeliveryAsync(connection, transaction, certificateId, DeliveryChannel.Email,
                certificate.ParticipantEmail!, now, cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
    }

    public async Task MarkIssuanceFailedAsync(long certificateId, string error, CancellationToken cancellationToken)
    {
        await using var connection = await database.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginWriteAsync(cancellationToken);
        var certificate = await FindByIdAsync(connection, transaction, certificateId, cancellationToken);
        if (certificate is null || certificate.Status != CertificateStatus.Pending)
        {
            await transaction.CommitAsync(cancellationToken);
            return;
        }

        var update = connection.CreateCommand();
        update.Transaction = transaction;
        update.CommandText = "UPDATE certificates SET status = 'Failed' WHERE id = @id AND status = 'Pending';";
        update.Parameters.AddWithValue("@id", certificateId);
        await update.ExecuteNonQueryAsync(cancellationToken);

        await AuditChain.AppendAsync(connection, transaction, "certificate.failed", certificate.PublicId,
            new Dictionary<string, string?> { ["error"] = Truncate(error, 500) }, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<DeliveryRecord?> ClaimNextDeliveryAsync(int maxAttempts, CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        await using var connection = await database.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginWriteAsync(cancellationToken);

        var select = connection.CreateCommand();
        select.Transaction = transaction;
        select.CommandText = """
            SELECT id, certificate_id, channel, destination, status, attempt_count,
                   next_attempt_at, provider_message_id, last_error
            FROM deliveries
            WHERE status IN ('Pending', 'Processing') AND next_attempt_at <= @now
              AND attempt_count < @maxAttempts
            ORDER BY next_attempt_at, id
            LIMIT 1;
            """;
        select.Parameters.AddWithValue("@now", Format(now));
        select.Parameters.AddWithValue("@maxAttempts", maxAttempts);

        DeliveryRecord? delivery = null;
        await using (var reader = await select.ExecuteReaderAsync(cancellationToken))
        {
            if (await reader.ReadAsync(cancellationToken))
            {
                delivery = ReadDelivery(reader);
            }
        }

        if (delivery is null)
        {
            await transaction.CommitAsync(cancellationToken);
            return null;
        }

        var leaseUntil = now.AddMinutes(5);
        var update = connection.CreateCommand();
        update.Transaction = transaction;
        update.CommandText = """
            UPDATE deliveries
            SET status = 'Processing', attempt_count = attempt_count + 1,
                next_attempt_at = @leaseUntil, updated_at = @now
            WHERE id = @id;
            """;
        update.Parameters.AddWithValue("@leaseUntil", Format(leaseUntil));
        update.Parameters.AddWithValue("@now", Format(now));
        update.Parameters.AddWithValue("@id", delivery.Id);
        await update.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return delivery with
        {
            Status = DeliveryStatus.Processing,
            AttemptCount = delivery.AttemptCount + 1,
            NextAttemptAt = leaseUntil
        };
    }

    public async Task CompleteDeliveryAsync(
        DeliveryRecord delivery,
        string providerMessageId,
        CancellationToken cancellationToken)
    {
        await using var connection = await database.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginWriteAsync(cancellationToken);
        var update = connection.CreateCommand();
        update.Transaction = transaction;
        update.CommandText = """
            UPDATE deliveries
            SET status = 'Sent', provider_message_id = @providerMessageId,
                last_error = NULL, updated_at = @now
            WHERE id = @id AND status = 'Processing';
            """;
        update.Parameters.AddWithValue("@providerMessageId", providerMessageId);
        update.Parameters.AddWithValue("@now", Format(DateTimeOffset.UtcNow));
        update.Parameters.AddWithValue("@id", delivery.Id);
        await update.ExecuteNonQueryAsync(cancellationToken);

        await AuditChain.AppendAsync(connection, transaction, "delivery.sent", delivery.CertificateId.ToString(CultureInfo.InvariantCulture),
            new Dictionary<string, string?>
            {
                ["channel"] = delivery.Channel.ToString(),
                ["providerMessageId"] = providerMessageId
            }, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<bool> FailDeliveryAsync(
        DeliveryRecord delivery,
        string error,
        bool transient,
        int maxAttempts,
        CancellationToken cancellationToken)
    {
        var finalFailure = !transient || delivery.AttemptCount >= maxAttempts;
        var delaySeconds = Math.Min(3600, 30 * Math.Pow(2, Math.Max(0, delivery.AttemptCount - 1)));
        var nextAttempt = DateTimeOffset.UtcNow.AddSeconds(delaySeconds);

        await using var connection = await database.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginWriteAsync(cancellationToken);
        var update = connection.CreateCommand();
        update.Transaction = transaction;
        update.CommandText = """
            UPDATE deliveries
            SET status = @status, next_attempt_at = @nextAttempt,
                last_error = @error, updated_at = @now
            WHERE id = @id AND status = 'Processing';
            """;
        update.Parameters.AddWithValue("@status", finalFailure ? "Failed" : "Pending");
        update.Parameters.AddWithValue("@nextAttempt", Format(nextAttempt));
        update.Parameters.AddWithValue("@error", Truncate(error, 1000));
        update.Parameters.AddWithValue("@now", Format(DateTimeOffset.UtcNow));
        update.Parameters.AddWithValue("@id", delivery.Id);
        await update.ExecuteNonQueryAsync(cancellationToken);

        await AuditChain.AppendAsync(connection, transaction,
            finalFailure ? "delivery.failed" : "delivery.retry_scheduled",
            delivery.CertificateId.ToString(CultureInfo.InvariantCulture),
            new Dictionary<string, string?>
            {
                ["attempt"] = delivery.AttemptCount.ToString(CultureInfo.InvariantCulture),
                ["channel"] = delivery.Channel.ToString(),
                ["error"] = Truncate(error, 500)
            }, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return finalFailure;
    }

    public async Task EnsureEmailDeliveryAsync(long certificateId, CancellationToken cancellationToken)
    {
        await using var connection = await database.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginWriteAsync(cancellationToken);
        var certificate = await FindByIdAsync(connection, transaction, certificateId, cancellationToken);
        if (certificate is not null && !string.IsNullOrWhiteSpace(certificate.ParticipantEmail))
        {
            await InsertDeliveryAsync(connection, transaction, certificateId, DeliveryChannel.Email,
                certificate.ParticipantEmail, DateTimeOffset.UtcNow, cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<CertificateRecord?> FindByPublicIdAsync(string publicId, CancellationToken cancellationToken)
    {
        await using var connection = await database.OpenConnectionAsync(cancellationToken);
        var command = connection.CreateCommand();
        command.CommandText = "SELECT * FROM certificates WHERE public_id = @publicId LIMIT 1;";
        command.Parameters.AddWithValue("@publicId", publicId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadCertificate(reader) : null;
    }

    public async Task<IReadOnlyList<CertificateRecord>> ListAsync(int take, CancellationToken cancellationToken)
    {
        var records = new List<CertificateRecord>();
        await using var connection = await database.OpenConnectionAsync(cancellationToken);
        var command = connection.CreateCommand();
        command.CommandText = "SELECT * FROM certificates ORDER BY created_at DESC, id DESC LIMIT @take;";
        command.Parameters.AddWithValue("@take", Math.Clamp(take, 1, 500));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            records.Add(ReadCertificate(reader));
        }

        return records;
    }

    public async Task<CertificateRecord?> FindByIdAsync(long id, CancellationToken cancellationToken)
    {
        await using var connection = await database.OpenConnectionAsync(cancellationToken);
        return await FindByIdAsync(connection, null, id, cancellationToken);
    }

    public async Task<bool> RevokeAsync(string publicId, string reason, CancellationToken cancellationToken)
    {
        await using var connection = await database.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginWriteAsync(cancellationToken);
        var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT * FROM certificates WHERE public_id = @publicId LIMIT 1;";
        command.Parameters.AddWithValue("@publicId", publicId);
        CertificateRecord? certificate;
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            certificate = await reader.ReadAsync(cancellationToken) ? ReadCertificate(reader) : null;
        }

        if (certificate is null)
        {
            await transaction.CommitAsync(cancellationToken);
            return false;
        }

        if (certificate.Status == CertificateStatus.Revoked)
        {
            await transaction.CommitAsync(cancellationToken);
            return true;
        }

        if (certificate.Status != CertificateStatus.Issued)
        {
            await transaction.CommitAsync(cancellationToken);
            return false;
        }

        var now = DateTimeOffset.UtcNow;
        var update = connection.CreateCommand();
        update.Transaction = transaction;
        update.CommandText = """
            UPDATE certificates
            SET status = 'Revoked', revoked_at = @revokedAt, revocation_reason = @reason
            WHERE id = @id AND status = 'Issued';
            """;
        update.Parameters.AddWithValue("@revokedAt", Format(now));
        update.Parameters.AddWithValue("@reason", Truncate(reason, 500));
        update.Parameters.AddWithValue("@id", certificate.Id);
        await update.ExecuteNonQueryAsync(cancellationToken);

        await AuditChain.AppendAsync(connection, transaction, "certificate.revoked", certificate.PublicId,
            new Dictionary<string, string?> { ["reason"] = Truncate(reason, 500) }, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    public async Task<AuditVerificationResult> VerifyAuditChainAsync(CancellationToken cancellationToken)
    {
        await using var connection = await database.OpenConnectionAsync(cancellationToken);
        return await AuditChain.VerifyAsync(connection, cancellationToken);
    }

    private static async Task<CertificateRecord?> FindByIssuanceKeyAsync(
        DbConnection connection,
        DbTransaction transaction,
        string issuanceKey,
        CancellationToken cancellationToken)
    {
        var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT * FROM certificates WHERE issuance_key = @issuanceKey LIMIT 1;";
        command.Parameters.AddWithValue("@issuanceKey", issuanceKey);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadCertificate(reader) : null;
    }

    private static async Task<CertificateRecord?> FindByIdAsync(
        DbConnection connection,
        DbTransaction? transaction,
        long id,
        CancellationToken cancellationToken)
    {
        var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT * FROM certificates WHERE id = @id LIMIT 1;";
        command.Parameters.AddWithValue("@id", id);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadCertificate(reader) : null;
    }

    private static async Task InsertDeliveryAsync(
        DbConnection connection,
        DbTransaction transaction,
        long certificateId,
        DeliveryChannel channel,
        string destination,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            INSERT INTO deliveries
                (certificate_id, channel, destination, status, attempt_count, next_attempt_at, updated_at)
            VALUES
                (@certificateId, @channel, @destination, 'Pending', 0, @now, @now) ON CONFLICT(certificate_id, channel, destination) DO NOTHING;
            """;
        command.Parameters.AddWithValue("@certificateId", certificateId);
        command.Parameters.AddWithValue("@channel", channel.ToString());
        command.Parameters.AddWithValue("@destination", destination);
        command.Parameters.AddWithValue("@now", Format(now));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static CertificateRecord ReadCertificate(DbDataReader reader) => new(
        reader.GetInt64(reader.GetOrdinal("id")),
        reader.GetString(reader.GetOrdinal("issuance_key")),
        reader.GetString(reader.GetOrdinal("public_id")),
        reader.GetString(reader.GetOrdinal("certificate_number")),
        reader.GetString(reader.GetOrdinal("event_id")),
        reader.GetString(reader.GetOrdinal("event_name")),
        reader.GetString(reader.GetOrdinal("source_id")),
        reader.GetString(reader.GetOrdinal("source_hash")),
        reader.GetString(reader.GetOrdinal("participant_name")),
        GetNullableString(reader, "participant_email"),
        GetNullableString(reader, "participant_phone"),
        reader.GetString(reader.GetOrdinal("template_id")),
        reader.GetInt32(reader.GetOrdinal("source_row_number")),
        Enum.Parse<CertificateStatus>(reader.GetString(reader.GetOrdinal("status")), true),
        GetNullableString(reader, "artifact_path"),
        GetNullableString(reader, "artifact_sha256"),
        GetNullableString(reader, "signer_thumbprint"),
        ParseDate(reader.GetString(reader.GetOrdinal("created_at"))),
        GetNullableDate(reader, "issued_at"),
        GetNullableDate(reader, "revoked_at"),
        GetNullableString(reader, "revocation_reason"));

    private static DeliveryRecord ReadDelivery(DbDataReader reader) => new(
        reader.GetInt64(0),
        reader.GetInt64(1),
        Enum.Parse<DeliveryChannel>(reader.GetString(2), true),
        reader.GetString(3),
        Enum.Parse<DeliveryStatus>(reader.GetString(4), true),
        reader.GetInt32(5),
        ParseDate(reader.GetString(6)),
        reader.IsDBNull(7) ? null : reader.GetString(7),
        reader.IsDBNull(8) ? null : reader.GetString(8));

    private static string? GetNullableString(DbDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);
    }

    private static DateTimeOffset? GetNullableDate(DbDataReader reader, string column)
    {
        var value = GetNullableString(reader, column);
        return value is null ? null : ParseDate(value);
    }

    private static DateTimeOffset ParseDate(string value) =>
        DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);

    private static string Format(DateTimeOffset value) =>
        value.UtcDateTime.ToString("O", CultureInfo.InvariantCulture);

    private static string CreatePublicId() =>
        Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();

    private static string CreateCertificateNumber(string eventId, DateTimeOffset now)
    {
        var safeEventId = new string(eventId.Where(char.IsLetterOrDigit).ToArray()).ToUpperInvariant();
        safeEventId = safeEventId.Length == 0 ? "CERT" : safeEventId[..Math.Min(12, safeEventId.Length)];
        return $"{safeEventId}-{now:yyyy}-{Convert.ToHexString(RandomNumberGenerator.GetBytes(5))}";
    }

    private static string Truncate(string value, int maximumLength) =>
        value.Length <= maximumLength ? value : value[..maximumLength];

    public static CertificateSummaryDto ToSummaryDto(CertificateRecord c) => new(
        c.PublicId,
        c.CertificateNumber,
        c.ParticipantName,
        c.ParticipantEmail,
        c.EventId,
        c.EventName,
        c.TemplateId,
        c.Status.ToString(),
        Format(c.CreatedAt),
        c.IssuedAt is null ? null : Format(c.IssuedAt.Value),
        c.RevokedAt is null ? null : Format(c.RevokedAt.Value),
        c.RevocationReason);

    public async Task<UserRecord?> FindUserByEmailAsync(string email, CancellationToken cancellationToken)
    {
        await using var connection = await database.OpenConnectionAsync(cancellationToken);
        var command = connection.CreateCommand();
        command.CommandText = "SELECT id, name, email, password_hash, role, created_at FROM users WHERE email = @email LIMIT 1;";
        command.Parameters.AddWithValue("@email", email.Trim().ToLowerInvariant());
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;
        return new UserRecord(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.GetString(4),
            ParseDate(reader.GetString(5)));
    }

    public async Task<UserRecord?> FindUserByIdAsync(long id, CancellationToken cancellationToken)
    {
        await using var connection = await database.OpenConnectionAsync(cancellationToken);
        var command = connection.CreateCommand();
        command.CommandText = "SELECT id, name, email, password_hash, role, created_at FROM users WHERE id = @id LIMIT 1;";
        command.Parameters.AddWithValue("@id", id);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;
        return new UserRecord(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.GetString(4),
            ParseDate(reader.GetString(5)));
    }

    public async Task<UserRecord> CreateUserAsync(string name, string email, string passwordHash, string role, CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        await using var connection = await database.OpenConnectionAsync(cancellationToken);
        var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO users (name, email, password_hash, role, created_at)
            VALUES (@name, @email, @passwordHash, @role, @createdAt)
            RETURNING id;
            """;
        command.Parameters.AddWithValue("@name", name.Trim());
        command.Parameters.AddWithValue("@email", email.Trim().ToLowerInvariant());
        command.Parameters.AddWithValue("@passwordHash", passwordHash);
        command.Parameters.AddWithValue("@role", string.IsNullOrWhiteSpace(role) ? "admin" : role.Trim());
        command.Parameters.AddWithValue("@createdAt", Format(now));
        var id = Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken), CultureInfo.InvariantCulture);
        return new UserRecord(id, name.Trim(), email.Trim().ToLowerInvariant(), passwordHash, role, now);
    }

    public async Task<IReadOnlyList<EventSummaryDto>> GetEventSummariesAsync(IReadOnlyList<EventSourceOptions> configuredEvents, CancellationToken cancellationToken)
    {
        var statsByEvent = new Dictionary<string, (int Total, int Issued, string? Earliest)>(StringComparer.OrdinalIgnoreCase);

        await using var connection = await database.OpenConnectionAsync(cancellationToken);
        var command = connection.CreateCommand();
        command.CommandText = """
            SELECT event_id,
                   COUNT(*) as total_count,
                   SUM(CASE WHEN status = 'Issued' THEN 1 ELSE 0 END) as issued_count,
                   MIN(created_at) as earliest_created_at
            FROM certificates
            GROUP BY event_id;
            """;
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                var eventId = reader.GetString(0);
                var total = Convert.ToInt32(reader.GetValue(1), CultureInfo.InvariantCulture);
                var issued = reader.IsDBNull(2) ? 0 : Convert.ToInt32(reader.GetValue(2), CultureInfo.InvariantCulture);
                var earliest = reader.IsDBNull(3) ? null : reader.GetString(3);
                statsByEvent[eventId] = (total, issued, earliest);
            }
        }

        var result = new List<EventSummaryDto>();
        var seenEventIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var ev in configuredEvents)
        {
            seenEventIds.Add(ev.EventId);
            statsByEvent.TryGetValue(ev.EventId, out var stat);
            result.Add(new EventSummaryDto(
                ev.EventId,
                ev.EventName,
                ev.TemplateId,
                stat.Earliest,
                stat.Issued,
                stat.Total));
        }

        foreach (var (eventId, stat) in statsByEvent)
        {
            if (seenEventIds.Add(eventId))
            {
                var metaCmd = connection.CreateCommand();
                metaCmd.CommandText = "SELECT event_name, template_id FROM certificates WHERE event_id = @eventId LIMIT 1;";
                metaCmd.Parameters.AddWithValue("@eventId", eventId);
                var evName = eventId;
                var tmplId = "default";
                await using var metaReader = await metaCmd.ExecuteReaderAsync(cancellationToken);
                if (await metaReader.ReadAsync(cancellationToken))
                {
                    evName = metaReader.GetString(0);
                    tmplId = metaReader.GetString(1);
                }

                result.Add(new EventSummaryDto(
                    eventId,
                    evName,
                    tmplId,
                    stat.Earliest,
                    stat.Issued,
                    stat.Total));
            }
        }

        return result;
    }

    public async Task<EventDetailDto?> GetEventDetailAsync(string eventId, IReadOnlyList<EventSourceOptions> configuredEvents, int page, int pageSize, CancellationToken cancellationToken)
    {
        var ev = configuredEvents.FirstOrDefault(e => string.Equals(e.EventId, eventId, StringComparison.OrdinalIgnoreCase));
        string eventName = ev?.EventName ?? eventId;
        string templateId = ev?.TemplateId ?? "default";

        await using var connection = await database.OpenConnectionAsync(cancellationToken);

        var statsCmd = connection.CreateCommand();
        statsCmd.CommandText = """
            SELECT MAX(event_name), MAX(template_id),
                   COUNT(*) as total_count,
                   SUM(CASE WHEN status = 'Issued' THEN 1 ELSE 0 END) as issued_count,
                   MIN(created_at) as earliest_created_at
            FROM certificates
            WHERE event_id = @eventId
            GROUP BY event_id;
            """;
        statsCmd.Parameters.AddWithValue("@eventId", eventId);

        int totalCount = 0;
        int issuedCount = 0;
        string? earliest = null;
        bool foundInDb = false;

        await using (var reader = await statsCmd.ExecuteReaderAsync(cancellationToken))
        {
            if (await reader.ReadAsync(cancellationToken))
            {
                foundInDb = true;
                if (ev is null)
                {
                    eventName = reader.GetString(0);
                    templateId = reader.GetString(1);
                }
                totalCount = Convert.ToInt32(reader.GetValue(2), CultureInfo.InvariantCulture);
                issuedCount = reader.IsDBNull(3) ? 0 : Convert.ToInt32(reader.GetValue(3), CultureInfo.InvariantCulture);
                earliest = reader.IsDBNull(4) ? null : reader.GetString(4);
            }
        }

        if (ev is null && !foundInDb)
        {
            return null;
        }

        var offset = (page - 1) * pageSize;
        var certsCmd = connection.CreateCommand();
        certsCmd.CommandText = """
            SELECT * FROM certificates
            WHERE event_id = @eventId
            ORDER BY id DESC
            LIMIT @limit OFFSET @offset;
            """;
        certsCmd.Parameters.AddWithValue("@eventId", eventId);
        certsCmd.Parameters.AddWithValue("@limit", pageSize);
        certsCmd.Parameters.AddWithValue("@offset", offset);

        var items = new List<CertificateSummaryDto>();
        await using (var reader = await certsCmd.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                items.Add(ToSummaryDto(ReadCertificate(reader)));
            }
        }

        var paginated = new PaginatedResultDto<CertificateSummaryDto>(items, page, pageSize, totalCount);
        return new EventDetailDto(eventId, eventName, templateId, earliest, issuedCount, totalCount, paginated);
    }

    public async Task<PaginatedResultDto<CertificateSummaryDto>> GetCertificatesPaginatedAsync(
        int page,
        int pageSize,
        string? eventId,
        string? status,
        string? search,
        CancellationToken cancellationToken)
    {
        await using var connection = await database.OpenConnectionAsync(cancellationToken);

        var whereClauses = new List<string>();
        var parameters = new List<(string Name, object Value)>();

        if (!string.IsNullOrWhiteSpace(eventId))
        {
            whereClauses.Add("event_id = @eventId");
            parameters.Add(("@eventId", eventId.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            whereClauses.Add("lower(status) = lower(@status)");
            parameters.Add(("@status", status.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            whereClauses.Add("(lower(participant_name) LIKE lower(@search) OR lower(certificate_number) LIKE lower(@search) OR lower(public_id) LIKE lower(@search))");
            parameters.Add(("@search", $"%{search.Trim()}%"));
        }

        var whereSql = whereClauses.Count > 0 ? "WHERE " + string.Join(" AND ", whereClauses) : "";

        var countCmd = connection.CreateCommand();
        countCmd.CommandText = $"SELECT COUNT(*) FROM certificates {whereSql};";
        foreach (var p in parameters) countCmd.Parameters.AddWithValue(p.Name, p.Value);
        var totalCount = Convert.ToInt32(await countCmd.ExecuteScalarAsync(cancellationToken), CultureInfo.InvariantCulture);

        var offset = (page - 1) * pageSize;
        var dataCmd = connection.CreateCommand();
        dataCmd.CommandText = $"SELECT * FROM certificates {whereSql} ORDER BY id DESC LIMIT @limit OFFSET @offset;";
        foreach (var p in parameters) dataCmd.Parameters.AddWithValue(p.Name, p.Value);
        dataCmd.Parameters.AddWithValue("@limit", pageSize);
        dataCmd.Parameters.AddWithValue("@offset", offset);

        var items = new List<CertificateSummaryDto>();
        await using (var reader = await dataCmd.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
            {
                items.Add(ToSummaryDto(ReadCertificate(reader)));
            }
        }

        return new PaginatedResultDto<CertificateSummaryDto>(items, page, pageSize, totalCount);
    }
}
