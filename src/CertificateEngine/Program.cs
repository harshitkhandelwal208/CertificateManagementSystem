using CertificateEngine.Api;
using CertificateEngine.Domain;
using CertificateEngine.Certificates;
using CertificateEngine.Configuration;
using CertificateEngine.Infrastructure.Delivery;
using CertificateEngine.Infrastructure.Audit;
using CertificateEngine.Infrastructure.Persistence;
using CertificateEngine.Infrastructure.Sheets;
using CertificateEngine.Infrastructure.Auth;
using Microsoft.Extensions.Options;
using System.Net;

var builder = WebApplication.CreateBuilder(args);
builder.Configuration
    .AddJsonFile(Path.Combine(AppContext.BaseDirectory, "appsettings.json"), optional: true)
    .AddJsonFile(Path.Combine(Directory.GetCurrentDirectory(), "src/CertificateEngine/appsettings.json"), optional: true);
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});
builder.Services.AddOptions<PlatformOptions>().Bind(builder.Configuration.GetSection(PlatformOptions.SectionName)).ValidateOnStart();
builder.Services.AddSingleton<IValidateOptions<PlatformOptions>, PlatformOptionsValidator>();
builder.Services.AddOptions<SigningOptions>().Bind(builder.Configuration.GetSection(SigningOptions.SectionName)).ValidateOnStart();
builder.Services.AddSingleton<IValidateOptions<SigningOptions>, SigningOptionsValidator>();
builder.Services.Configure<GoogleSheetsOptions>(builder.Configuration.GetSection(GoogleSheetsOptions.SectionName));
builder.Services.AddSingleton<CertificateDatabase>();
builder.Services.AddSingleton<CertificateRepository>();
builder.Services.AddSingleton<CertificateArtifactService>();
builder.Services.AddSingleton<IGoogleSheetsClient, GoogleSheetsClient>();
builder.Services.AddSingleton<ISheetSource, GoogleSheetsSource>();
builder.Services.AddSingleton<CertificateIssuanceWorker>();
builder.Services.AddHostedService(serviceProvider => serviceProvider.GetRequiredService<CertificateIssuanceWorker>());
builder.Services.AddCertificateDelivery(builder.Configuration);

var app = builder.Build();
app.UseCors();
await app.Services.GetRequiredService<CertificateDatabase>().InitializeAsync(CancellationToken.None);

if (args.Length > 0 && (args[0] == "issue" || args[0] == "issue-batch"))
{
    var repository = app.Services.GetRequiredService<CertificateRepository>();
    var artifacts = app.Services.GetRequiredService<CertificateArtifactService>();
    var options = app.Services.GetRequiredService<IOptions<PlatformOptions>>();

    string jsonPayload;
    if (args.Length > 1)
    {
        jsonPayload = args[1];
    }
    else
    {
        using var reader = new StreamReader(Console.OpenStandardInput());
        jsonPayload = await reader.ReadToEndAsync();
    }

    var jsonOpts = new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web);

    if (args[0] == "issue")
    {
        var body = System.Text.Json.JsonSerializer.Deserialize<DemoIssueRequest>(jsonPayload, jsonOpts);
        if (body is null || string.IsNullOrWhiteSpace(body.FullName))
        {
            Console.Error.WriteLine("Error: FullName is required.");
            return 1;
        }

        var targetEventId = string.IsNullOrWhiteSpace(body.EventId)
            ? (options.Value.Events.Count > 0 ? options.Value.Events[0].EventId : "general-cohort")
            : body.EventId.Trim();

        var configuredEvent = options.Value.Events.FirstOrDefault(e => string.Equals(e.EventId, targetEventId, StringComparison.OrdinalIgnoreCase));
        var eventOptions = configuredEvent ?? new EventSourceOptions
        {
            EventId = targetEventId,
            EventName = string.IsNullOrWhiteSpace(body.EventName)
                ? (targetEventId == "local-demo" ? "Local testing event" : targetEventId)
                : body.EventName.Trim(),
            TemplateId = string.IsNullOrWhiteSpace(body.TemplateId) ? "default" : body.TemplateId.Trim()
        };
        if (!string.IsNullOrWhiteSpace(body.EventName))
        {
            eventOptions.EventName = body.EventName.Trim();
        }
        if (!string.IsNullOrWhiteSpace(body.TemplateId))
        {
            eventOptions.TemplateId = body.TemplateId.Trim();
        }

        var sourceId = Guid.NewGuid().ToString("N");
        var submission = new SheetSubmission(
            eventOptions.EventId,
            eventOptions.EventName,
            string.Empty,
            string.Empty,
            0,
            new Participant(sourceId, body.FullName.Trim(), body.Email?.Trim(), body.Phone?.Trim()),
            sourceId,
            null,
            new Dictionary<string, string>());

        var (certificate, _) = await repository.GetOrCreateAsync(submission, eventOptions, CancellationToken.None);
        var artifact = await artifacts.CreateAsync(certificate, body.Layout, CancellationToken.None);
        await repository.MarkIssuedAsync(certificate.Id, artifact.ArtifactPath, artifact.Sha256, artifact.SignerThumbprint, eventOptions, CancellationToken.None);

        var result = new
        {
            publicId = certificate.PublicId,
            certificateNumber = certificate.CertificateNumber,
            verifyPath = $"/verify/{certificate.PublicId}",
            artifactPath = artifact.ArtifactPath,
            artifactSha256 = artifact.Sha256
        };
        Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(result));
        return 0;
    }
    else if (args[0] == "issue-batch")
    {
        var body = System.Text.Json.JsonSerializer.Deserialize<BatchIssueRequest>(jsonPayload, jsonOpts);
        if (body?.Recipients is null || body.Recipients.Count == 0)
        {
            Console.Error.WriteLine("Error: Recipients list is required.");
            return 1;
        }

        var targetEventId = string.IsNullOrWhiteSpace(body.EventId)
            ? (options.Value.Events.Count > 0 ? options.Value.Events[0].EventId : "general-cohort")
            : body.EventId.Trim();

        var configuredEvent = options.Value.Events.FirstOrDefault(e => string.Equals(e.EventId, targetEventId, StringComparison.OrdinalIgnoreCase));
        var eventOptions = configuredEvent ?? new EventSourceOptions
        {
            EventId = targetEventId,
            EventName = string.IsNullOrWhiteSpace(body.EventName)
                ? (targetEventId == "local-demo" ? "Local testing event" : targetEventId)
                : body.EventName.Trim(),
            TemplateId = string.IsNullOrWhiteSpace(body.TemplateId) ? "default" : body.TemplateId.Trim()
        };
        if (!string.IsNullOrWhiteSpace(body.EventName))
        {
            eventOptions.EventName = body.EventName.Trim();
        }
        if (!string.IsNullOrWhiteSpace(body.TemplateId))
        {
            eventOptions.TemplateId = body.TemplateId.Trim();
        }

        var results = new List<object>();
        foreach (var recipient in body.Recipients)
        {
            if (string.IsNullOrWhiteSpace(recipient.Name)) continue;
            try
            {
                var sourceId = Guid.NewGuid().ToString("N");
                var submission = new SheetSubmission(
                    eventOptions.EventId,
                    eventOptions.EventName,
                    string.Empty,
                    string.Empty,
                    0,
                    new Participant(sourceId, recipient.Name.Trim(), recipient.Email?.Trim(), recipient.Phone?.Trim()),
                    sourceId,
                    null,
                    new Dictionary<string, string>());

                var (cert, _) = await repository.GetOrCreateAsync(submission, eventOptions, CancellationToken.None);
                var artifact = await artifacts.CreateAsync(cert, body.Layout, CancellationToken.None);
                await repository.MarkIssuedAsync(cert.Id, artifact.ArtifactPath, artifact.Sha256, artifact.SignerThumbprint, eventOptions, CancellationToken.None);
                results.Add(new
                {
                    publicId = cert.PublicId,
                    certificateNumber = cert.CertificateNumber,
                    recipientName = cert.ParticipantName,
                    status = "Issued",
                    verifyPath = $"/verify/{cert.PublicId}"
                });
            }
            catch (Exception ex)
            {
                results.Add(new
                {
                    recipientName = recipient.Name,
                    status = "Failed",
                    error = ex.Message
                });
            }
        }

        var response = new
        {
            totalProcessed = body.Recipients.Count,
            issuedCount = results.Count(r => ((dynamic)r).status == "Issued"),
            results
        };
        Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(response));
        return 0;
    }
}

bool Authorized(HttpRequest request, IOptions<PlatformOptions> options) => request.Headers.TryGetValue("X-Api-Key", out var key) && key.Count == 1 && string.Equals(key[0], options.Value.InternalApiKey, StringComparison.Ordinal);
bool ManagementAuthorized(HttpContext context, IOptions<PlatformOptions> options) =>
    context.Connection.RemoteIpAddress is not null && IPAddress.IsLoopback(context.Connection.RemoteIpAddress)
    || Authorized(context.Request, options);

async Task<IResult> ManagementPageAsync(HttpContext context, IOptions<PlatformOptions> options, CertificateRepository repository, string? notice, AuditVerificationResult? audit, CancellationToken ct)
{
    if (!ManagementAuthorized(context, options)) return Results.Unauthorized();
    var platform = options.Value;
    var certificates = await repository.ListAsync(200, ct);
    return Results.Content(ManagementLanding.Page(certificates, platform.Events, platform.Events.Count == 0, platform.PublicBaseUrl, notice, audit), "text/html");
}

app.MapGet("/", (HttpContext context, string? notice, IOptions<PlatformOptions> options, CertificateRepository repository, CancellationToken ct) =>
    ManagementPageAsync(context, options, repository, notice, null, ct));
app.MapGet("/favicon.ico", () => Results.NoContent());
app.MapGet("/verify/{**path}", () => Results.NotFound());

app.MapPost("/manage/issue", async (HttpContext context, IOptions<PlatformOptions> options, CertificateRepository repository, CertificateArtifactService artifacts, CancellationToken ct) =>
{
    if (!ManagementAuthorized(context, options)) return Results.Unauthorized();
    if (options.Value.Events.Count != 0) return Results.BadRequest("Demo issuance is disabled while production events are configured.");
    var form = await context.Request.ReadFormAsync(ct);
    var fullName = form["fullName"].ToString().Trim();
    var eventName = form["eventName"].ToString().Trim();
    if (string.IsNullOrWhiteSpace(fullName)) return Results.BadRequest("Participant full name is required.");
    var eventOptions = new EventSourceOptions { EventId = "local-demo", EventName = string.IsNullOrWhiteSpace(eventName) ? "Local testing event" : eventName, TemplateId = "default" };
    var sourceId = Guid.NewGuid().ToString("N");
    var submission = new SheetSubmission(eventOptions.EventId, eventOptions.EventName, string.Empty, string.Empty, 0,
        new Participant(sourceId, fullName, null, null), sourceId, null, new Dictionary<string, string>());
    var (certificate, _) = await repository.GetOrCreateAsync(submission, eventOptions, ct);
    var artifact = await artifacts.CreateAsync(certificate, ct);
    await repository.MarkIssuedAsync(certificate.Id, artifact.ArtifactPath, artifact.Sha256, artifact.SignerThumbprint, eventOptions, ct);
    return Results.Redirect($"/?notice={Uri.EscapeDataString($"Issued {certificate.CertificateNumber} for {certificate.ParticipantName}.")}");
});

app.MapPost("/manage/certificates/{publicId}/revoke", async (string publicId, HttpContext context, IOptions<PlatformOptions> options, CertificateRepository repository, CancellationToken ct) =>
{
    if (!ManagementAuthorized(context, options)) return Results.Unauthorized();
    var form = await context.Request.ReadFormAsync(ct);
    var reason = form["reason"].ToString().Trim();
    if (string.IsNullOrWhiteSpace(reason)) return Results.BadRequest("A revocation reason is required.");
    var revoked = await repository.RevokeAsync(publicId, reason, ct);
    return Results.Redirect($"/?notice={Uri.EscapeDataString(revoked ? "Certificate revoked." : "Certificate could not be revoked.")}");
});

app.MapPost("/manage/events/{eventId}/poll", async (string eventId, HttpContext context, IOptions<PlatformOptions> options, CertificateIssuanceWorker worker, CancellationToken ct) =>
{
    if (!ManagementAuthorized(context, options)) return Results.Unauthorized();
    var eventOptions = options.Value.Events.FirstOrDefault(e => string.Equals(e.EventId, eventId, StringComparison.OrdinalIgnoreCase));
    if (eventOptions is null) return Results.NotFound();
    await worker.PollEventAsync(eventOptions, ct);
    return Results.Redirect($"/?notice={Uri.EscapeDataString($"Polled {eventOptions.EventName}.")}");
});

app.MapPost("/manage/audit", async (HttpContext context, IOptions<PlatformOptions> options, CertificateRepository repository, CancellationToken ct) =>
    await ManagementPageAsync(context, options, repository, null, await repository.VerifyAuditChainAsync(ct), ct));

app.MapGet("/manage/certificates/{publicId}/download", async (string publicId, HttpContext context, IOptions<PlatformOptions> options, CertificateRepository repository, CertificateDatabase database, CancellationToken ct) =>
{
    if (!ManagementAuthorized(context, options)) return Results.Unauthorized();
    var certificate = await repository.FindByPublicIdAsync(publicId, ct);
    if (certificate?.ArtifactPath is not { Length: > 0 } artifactPath) return Results.NotFound();
    var root = Path.GetFullPath(database.DataDirectory).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
    var file = Path.GetFullPath(Path.Combine(root, artifactPath.Replace('/', Path.DirectorySeparatorChar)));
    if (!file.StartsWith(root, StringComparison.OrdinalIgnoreCase) || !File.Exists(file)) return Results.NotFound();
    return Results.File(file, "application/pdf", $"certificate-{certificate.CertificateNumber}.pdf");
});

app.MapGet("/internal/health", (HttpRequest request, IOptions<PlatformOptions> options) => Authorized(request, options) ? Results.Ok(new { status = "ok" }) : Results.Unauthorized());

app.MapGet("/internal/events", async (HttpRequest request, IOptions<PlatformOptions> options, CertificateRepository repository, CancellationToken ct) =>
{
    if (!Authorized(request, options)) return Results.Unauthorized();
    var events = await repository.GetEventSummariesAsync(options.Value.Events, ct);
    return Results.Ok(events);
});

app.MapGet("/internal/events/{eventId}", async (string eventId, HttpRequest request, IOptions<PlatformOptions> options, CertificateRepository repository, int? page, int? pageSize, CancellationToken ct) =>
{
    if (!Authorized(request, options)) return Results.Unauthorized();
    var p = Math.Max(1, page ?? 1);
    var ps = Math.Clamp(pageSize ?? 50, 1, 200);
    var detail = await repository.GetEventDetailAsync(eventId, options.Value.Events, p, ps, ct);
    return detail is null ? Results.NotFound(new { error = $"Event '{eventId}' not found." }) : Results.Ok(detail);
});

app.MapGet("/internal/certificates", async (HttpRequest request, IOptions<PlatformOptions> options, CertificateRepository repository, int? page, int? pageSize, string? eventId, string? status, string? search, CancellationToken ct) =>
{
    if (!Authorized(request, options)) return Results.Unauthorized();
    var p = Math.Max(1, page ?? 1);
    var ps = Math.Clamp(pageSize ?? 50, 1, 200);
    var result = await repository.GetCertificatesPaginatedAsync(p, ps, eventId, status, search, ct);
    return Results.Ok(result);
});

app.MapGet("/internal/certificates/{publicId}", async (string publicId, HttpRequest request, IOptions<PlatformOptions> options, CertificateRepository repository, CancellationToken ct) =>
{
    if (!Authorized(request, options)) return Results.Unauthorized();
    var certificate = await repository.FindByPublicIdAsync(publicId, ct);
    return certificate is null ? Results.NotFound(new { error = "Certificate not found" }) : Results.Ok(CertificateRepository.ToSummaryDto(certificate));
});

app.MapPost("/internal/demo/issue", async (DemoIssueRequest body, HttpRequest request, IOptions<PlatformOptions> options, CertificateRepository repository, CertificateArtifactService artifacts, CancellationToken ct) =>
{
    if (!Authorized(request, options)) return Results.Unauthorized();
    if (string.IsNullOrWhiteSpace(body.FullName)) return Results.BadRequest(new { error = "FullName is required." });

    var targetEventId = string.IsNullOrWhiteSpace(body.EventId)
        ? (options.Value.Events.Count > 0 ? options.Value.Events[0].EventId : "local-demo")
        : body.EventId.Trim();

    var configuredEvent = options.Value.Events.FirstOrDefault(e => string.Equals(e.EventId, targetEventId, StringComparison.OrdinalIgnoreCase));
    var eventOptions = configuredEvent ?? new EventSourceOptions
    {
        EventId = targetEventId,
        EventName = string.IsNullOrWhiteSpace(body.EventName)
            ? (targetEventId == "local-demo" ? "Local testing event" : targetEventId)
            : body.EventName.Trim(),
        TemplateId = "default"
    };

    var sourceId = Guid.NewGuid().ToString("N");
    var submission = new SheetSubmission(
        eventOptions.EventId,
        eventOptions.EventName,
        string.Empty,
        string.Empty,
        0,
        new Participant(sourceId, body.FullName.Trim(), body.Email?.Trim(), body.Phone?.Trim()),
        sourceId,
        null,
        new Dictionary<string, string>());

    var (certificate, _) = await repository.GetOrCreateAsync(submission, eventOptions, ct);
    var artifact = await artifacts.CreateAsync(certificate, ct);
    await repository.MarkIssuedAsync(certificate.Id, artifact.ArtifactPath, artifact.Sha256, artifact.SignerThumbprint, eventOptions, ct);
    return Results.Created($"/verify/{certificate.PublicId}", new { certificate.PublicId, certificate.CertificateNumber, verifyPath = $"/verify/{certificate.PublicId}" });
});

app.MapPost("/internal/issue/batch", async (BatchIssueRequest body, HttpRequest request, IOptions<PlatformOptions> options, CertificateRepository repository, CertificateArtifactService artifacts, CancellationToken ct) =>
{
    if (!Authorized(request, options)) return Results.Unauthorized();
    if (body.Recipients is null || body.Recipients.Count == 0)
        return Results.BadRequest(new { error = "Recipients list is required." });

    var targetEventId = string.IsNullOrWhiteSpace(body.EventId)
        ? (options.Value.Events.Count > 0 ? options.Value.Events[0].EventId : "local-demo")
        : body.EventId.Trim();

    var configuredEvent = options.Value.Events.FirstOrDefault(e => string.Equals(e.EventId, targetEventId, StringComparison.OrdinalIgnoreCase));
    var eventOptions = configuredEvent ?? new EventSourceOptions
    {
        EventId = targetEventId,
        EventName = string.IsNullOrWhiteSpace(body.EventName)
            ? (targetEventId == "local-demo" ? "Local testing event" : targetEventId)
            : body.EventName.Trim(),
        TemplateId = string.IsNullOrWhiteSpace(body.TemplateId) ? "default" : body.TemplateId.Trim()
    };

    var results = new List<object>();
    foreach (var recipient in body.Recipients)
    {
        if (string.IsNullOrWhiteSpace(recipient.Name)) continue;
        try
        {
            var sourceId = Guid.NewGuid().ToString("N");
            var submission = new SheetSubmission(
                eventOptions.EventId,
                eventOptions.EventName,
                string.Empty,
                string.Empty,
                0,
                new Participant(sourceId, recipient.Name.Trim(), recipient.Email?.Trim(), recipient.Phone?.Trim()),
                sourceId,
                null,
                new Dictionary<string, string>());

            var (certificate, _) = await repository.GetOrCreateAsync(submission, eventOptions, ct);
            var artifact = await artifacts.CreateAsync(certificate, ct);
            await repository.MarkIssuedAsync(certificate.Id, artifact.ArtifactPath, artifact.Sha256, artifact.SignerThumbprint, eventOptions, ct);
            results.Add(new
            {
                success = true,
                name = recipient.Name,
                data = new
                {
                    certificate.PublicId,
                    certificate.CertificateNumber,
                    verifyPath = $"/verify/{certificate.PublicId}"
                }
            });
        }
        catch (Exception ex)
        {
            results.Add(new
            {
                success = false,
                name = recipient.Name,
                error = ex.Message
            });
        }
    }

    return Results.Ok(results);
});

app.MapPost("/internal/auth/register", async (RegisterRequest body, HttpRequest request, IOptions<PlatformOptions> options, CertificateRepository repository, CancellationToken ct) =>
{
    if (!Authorized(request, options)) return Results.Unauthorized();
    if (string.IsNullOrWhiteSpace(body.Name) || string.IsNullOrWhiteSpace(body.Email) || string.IsNullOrWhiteSpace(body.Password))
    {
        return Results.BadRequest(new { error = "Name, email, and password are required." });
    }

    var existing = await repository.FindUserByEmailAsync(body.Email, ct);
    if (existing is not null)
    {
        return Results.Conflict(new { error = "An account with this email already exists." });
    }

    var hash = PasswordHasher.HashPassword(body.Password);
    var user = await repository.CreateUserAsync(body.Name, body.Email, hash, "admin", ct);
    var accessToken = PasswordHasher.GenerateToken();
    var refreshToken = PasswordHasher.GenerateToken();

    return Results.Ok(new AuthResponse(
        accessToken,
        refreshToken,
        new UserInfo(user.Id, user.Name, user.Email, user.Role)));
});

app.MapPost("/internal/auth/login", async (LoginRequest body, HttpRequest request, IOptions<PlatformOptions> options, CertificateRepository repository, CancellationToken ct) =>
{
    if (!Authorized(request, options)) return Results.Unauthorized();
    if (string.IsNullOrWhiteSpace(body.Email) || string.IsNullOrWhiteSpace(body.Password))
    {
        return Results.BadRequest(new { error = "Email and password are required." });
    }

    var user = await repository.FindUserByEmailAsync(body.Email, ct);
    if (user is null || !PasswordHasher.VerifyPassword(body.Password, user.PasswordHash))
    {
        return Results.Unauthorized();
    }

    var accessToken = PasswordHasher.GenerateToken();
    var refreshToken = PasswordHasher.GenerateToken();

    return Results.Ok(new AuthResponse(
        accessToken,
        refreshToken,
        new UserInfo(user.Id, user.Name, user.Email, user.Role)));
});

app.MapPost("/internal/auth/refresh", (RefreshRequest body, HttpRequest request, IOptions<PlatformOptions> options) =>
{
    if (!Authorized(request, options)) return Results.Unauthorized();
    if (string.IsNullOrWhiteSpace(body.RefreshToken))
    {
        return Results.BadRequest(new { error = "Refresh token is required." });
    }

    var accessToken = PasswordHasher.GenerateToken();
    var refreshToken = PasswordHasher.GenerateToken();

    return Results.Ok(new
    {
        accessToken,
        refreshToken
    });
});

app.MapPost("/internal/auth/logout", () => Results.Ok(new { success = true }));

app.MapPost("/internal/events/{eventId}/poll-now", async (string eventId, HttpRequest request, IOptions<PlatformOptions> options, CertificateIssuanceWorker worker, CancellationToken ct) =>
{
    if (!Authorized(request, options)) return Results.Unauthorized();
    var eventOptions = options.Value.Events.FirstOrDefault(e => string.Equals(e.EventId, eventId, StringComparison.OrdinalIgnoreCase));
    if (eventOptions is null) return Results.NotFound();
    await worker.PollEventAsync(eventOptions, ct); return Results.Accepted();
});

app.MapPost("/internal/certificates/{publicId}/revoke", async (string publicId, RevokeRequest body, HttpRequest request, IOptions<PlatformOptions> options, CertificateRepository repository, CancellationToken ct) =>
{
    if (!Authorized(request, options)) return Results.Unauthorized();
    if (string.IsNullOrWhiteSpace(body.Reason)) return Results.BadRequest(new { error = "A revocation reason is required." });
    return await repository.RevokeAsync(publicId, body.Reason, ct) ? Results.NoContent() : Results.NotFound();
});

app.MapGet("/internal/audit/verify", async (HttpRequest request, IOptions<PlatformOptions> options, CertificateRepository repository, CancellationToken ct) => Authorized(request, options) ? Results.Ok(await repository.VerifyAuditChainAsync(ct)) : Results.Unauthorized());

if (args.Contains("--serve"))
{
    await app.RunAsync();
    return 0;
}
else
{
    Console.WriteLine("CertificateEngine CLI ready. Background daemon disabled. Use 'issue' or 'issue-batch' to issue credentials.");
    return 0;
}
