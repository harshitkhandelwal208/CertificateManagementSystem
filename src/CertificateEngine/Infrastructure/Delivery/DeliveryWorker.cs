using System.Collections.ObjectModel;
using System.Security;
using CertificateEngine.Configuration;
using CertificateEngine.Domain;
using CertificateEngine.Infrastructure.Persistence;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace CertificateEngine.Infrastructure.Delivery;

public sealed class DeliveryWorker : BackgroundService
{
    private static readonly Action<ILogger, Exception?> LogWorkerCycleFailure =
        LoggerMessage.Define(
            LogLevel.Error,
            new EventId(2001, nameof(LogWorkerCycleFailure)),
            "The certificate delivery worker cycle failed; processing will be retried.");

    private static readonly Action<ILogger, long, Exception?> LogFallbackFailure =
        LoggerMessage.Define<long>(
            LogLevel.Error,
            new EventId(2002, nameof(LogFallbackFailure)),
            "Email fallback could not be queued for certificate {CertificateId}.");

    private readonly CertificateRepository _repository;
    private readonly CertificateDatabase _database;
    private readonly ReadOnlyDictionary<DeliveryChannel, IDeliveryChannel> _channels;
    private readonly IOptions<PlatformOptions> _platformOptions;
    private readonly ILogger<DeliveryWorker> _logger;

    public DeliveryWorker(
        CertificateRepository repository,
        CertificateDatabase database,
        IEnumerable<IDeliveryChannel> channels,
        IOptions<PlatformOptions> platformOptions,
        ILogger<DeliveryWorker> logger)
    {
        ArgumentNullException.ThrowIfNull(repository);
        ArgumentNullException.ThrowIfNull(database);
        ArgumentNullException.ThrowIfNull(channels);
        ArgumentNullException.ThrowIfNull(platformOptions);
        ArgumentNullException.ThrowIfNull(logger);

        _repository = repository;
        _database = database;
        _channels = new ReadOnlyDictionary<DeliveryChannel, IDeliveryChannel>(
            channels.ToDictionary(channel => channel.Channel));
        _platformOptions = platformOptions;
        _logger = logger;
    }

    public async Task<bool> ProcessNextAsync(CancellationToken cancellationToken)
    {
        var platformOptions = _platformOptions.Value;
        var delivery = await _repository.ClaimNextDeliveryAsync(
            platformOptions.MaxDeliveryAttempts,
            cancellationToken);
        if (delivery is null)
        {
            return false;
        }

        var certificate = await _repository.FindByIdAsync(
            delivery.CertificateId,
            cancellationToken);
        var result = certificate is null
            ? SendResult.PermanentFailure(
                "The certificate referenced by this delivery no longer exists.")
            : await DispatchAsync(delivery, certificate, platformOptions, cancellationToken);

        if (result.Success && !string.IsNullOrWhiteSpace(result.ProviderMessageId))
        {
            await _repository.CompleteDeliveryAsync(
                delivery,
                result.ProviderMessageId,
                cancellationToken);
            return true;
        }

        var error = result.Success
            ? "The delivery channel reported success without a provider message identifier."
            : string.IsNullOrWhiteSpace(result.Error)
                ? "The delivery channel returned an unspecified failure."
                : result.Error;
        var finalFailure = await _repository.FailDeliveryAsync(
            delivery,
            error,
            result.Success || result.IsTransient,
            platformOptions.MaxDeliveryAttempts,
            cancellationToken);

        if (finalFailure
            && delivery.Channel == DeliveryChannel.WhatsApp
            && certificate is not null
            && ShouldQueueEmailFallback(certificate, platformOptions))
        {
            await QueueEmailFallbackAsync(certificate.Id, cancellationToken);
        }

        return true;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var processedDelivery = false;
            try
            {
                processedDelivery = await ProcessNextAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
#pragma warning disable CA1031 // A hosted worker must survive a failed repository cycle.
            catch (Exception exception)
#pragma warning restore CA1031
            {
                LogWorkerCycleFailure(_logger, exception);
            }

            if (processedDelivery)
            {
                continue;
            }

            var pollSeconds = Math.Max(1, _platformOptions.Value.DeliveryPollSeconds);
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(pollSeconds), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    private async Task<SendResult> DispatchAsync(
        DeliveryRecord delivery,
        CertificateRecord certificate,
        PlatformOptions platformOptions,
        CancellationToken cancellationToken)
    {
        if (certificate.Status != CertificateStatus.Issued)
        {
            return SendResult.PermanentFailure(
                $"Certificate delivery requires Issued status, but the certificate is {certificate.Status}.");
        }

        if (string.IsNullOrWhiteSpace(certificate.ArtifactPath))
        {
            return SendResult.PermanentFailure(
                "The issued certificate does not have an artifact path.");
        }

        if (!_channels.TryGetValue(delivery.Channel, out var channel))
        {
            return SendResult.PermanentFailure(
                $"No delivery channel is registered for {delivery.Channel}.");
        }

        if (!TryCreateVerificationUri(
                platformOptions.PublicBaseUrl,
                certificate.PublicId,
                out var verificationUri))
        {
            return SendResult.PermanentFailure(
                "Platform PublicBaseUrl cannot produce an HTTPS certificate verification URL.");
        }

        try
        {
            var artifactPath = ResolveArtifactPath(
                _database.DataDirectory,
                certificate.ArtifactPath);
            await using var artifact = new FileStream(
                artifactPath,
                new FileStreamOptions
                {
                    Mode = FileMode.Open,
                    Access = FileAccess.Read,
                    Share = FileShare.Read,
                    BufferSize = 64 * 1024,
                    Options = FileOptions.Asynchronous | FileOptions.SequentialScan
                });
            var request = new DeliveryRequest(
                delivery,
                certificate,
                artifact,
                $"certificate-{certificate.CertificateNumber}.pdf",
                verificationUri);

            try
            {
                return await channel.SendAsync(request, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
#pragma warning disable CA1031 // Channel failures are converted into safe retry results.
            catch (Exception)
#pragma warning restore CA1031
            {
                return SendResult.TransientFailure(
                    "The delivery channel failed unexpectedly; the delivery can be retried.");
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (FileNotFoundException)
        {
            return SendResult.PermanentFailure(
                "The certificate PDF was not found at its recorded artifact path.");
        }
        catch (DirectoryNotFoundException)
        {
            return SendResult.PermanentFailure(
                "The certificate artifact directory does not exist.");
        }
        catch (UnauthorizedAccessException)
        {
            return SendResult.PermanentFailure(
                "The certificate PDF cannot be read because artifact access was denied.");
        }
        catch (SecurityException)
        {
            return SendResult.PermanentFailure(
                "The certificate PDF cannot be read because artifact access was denied.");
        }
        catch (PathTooLongException)
        {
            return SendResult.PermanentFailure(
                "The certificate artifact path is too long.");
        }
        catch (ArgumentException)
        {
            return SendResult.PermanentFailure(
                "The certificate artifact path is invalid.");
        }
        catch (NotSupportedException)
        {
            return SendResult.PermanentFailure(
                "The certificate artifact path format is not supported.");
        }
        catch (IOException)
        {
            return SendResult.TransientFailure(
                "The certificate PDF could not be read due to a temporary I/O error.");
        }
    }

    private async Task QueueEmailFallbackAsync(
        long certificateId,
        CancellationToken cancellationToken)
    {
        try
        {
            await _repository.EnsureEmailDeliveryAsync(certificateId, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
#pragma warning disable CA1031 // The WhatsApp outcome is already durable; keep the worker alive.
        catch (Exception exception)
#pragma warning restore CA1031
        {
            LogFallbackFailure(_logger, certificateId, exception);
        }
    }

    private static bool ShouldQueueEmailFallback(
        CertificateRecord certificate,
        PlatformOptions platformOptions)
    {
        if (string.IsNullOrWhiteSpace(certificate.ParticipantEmail))
        {
            return false;
        }

        var eventOptions = platformOptions.Events.FirstOrDefault(eventSource =>
            string.Equals(
                eventSource.EventId,
                certificate.EventId,
                StringComparison.OrdinalIgnoreCase));
        return eventOptions?.EmailFallbackForWhatsApp == true;
    }

    private static string ResolveArtifactPath(string dataDirectory, string artifactPath)
    {
        if (Path.IsPathRooted(artifactPath))
        {
            return Path.GetFullPath(artifactPath);
        }

        var dataRoot = Path.IsPathRooted(dataDirectory)
            ? Path.GetFullPath(dataDirectory)
            : Path.GetFullPath(dataDirectory);
        return Path.GetFullPath(artifactPath, dataRoot);
    }

    private static bool TryCreateVerificationUri(
        string publicBaseUrl,
        string publicId,
        out Uri verificationUri)
    {
        verificationUri = null!;
        if (string.IsNullOrWhiteSpace(publicId)
            || !Uri.TryCreate(publicBaseUrl, UriKind.Absolute, out var baseUri)
            || (baseUri.Scheme != Uri.UriSchemeHttps
                && !(baseUri.Scheme == Uri.UriSchemeHttp && baseUri.IsLoopback)))
        {
            return false;
        }

        var builder = new UriBuilder(baseUri)
        {
            Path = $"{baseUri.AbsolutePath.TrimEnd('/')}/verify/{Uri.EscapeDataString(publicId)}",
            Query = string.Empty,
            Fragment = string.Empty
        };
        verificationUri = builder.Uri;
        return true;
    }
}
