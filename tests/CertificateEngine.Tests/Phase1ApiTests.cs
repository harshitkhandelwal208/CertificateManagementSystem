using CertificateEngine.Api;
using CertificateEngine.Configuration;
using CertificateEngine.Domain;
using CertificateEngine.Infrastructure.Auth;
using CertificateEngine.Infrastructure.Persistence;
using Microsoft.Extensions.Options;
using Xunit;

namespace CertificateEngine.Tests;

public sealed class Phase1ApiTests : IDisposable
{
    private readonly string _tempDir;
    private readonly CertificateDatabase _database;
    private readonly CertificateRepository _repository;

    public Phase1ApiTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "certeng_tests_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_tempDir);

        var options = Options.Create(new PlatformOptions
        {
            DataDirectory = _tempDir,
            PublicBaseUrl = "http://localhost:5001",
            InternalApiKey = "test-key-32-chars-long-example!!",
            Events =
            [
                new EventSourceOptions
                {
                    EventId = "hackathon-2026",
                    EventName = "Hackathon 2026",
                    SpreadsheetId = "sheet123",
                    TemplateId = "tech-template"
                }
            ]
        });

        _database = new CertificateDatabase(options);
        _database.InitializeAsync(CancellationToken.None).GetAwaiter().GetResult();
        _repository = new CertificateRepository(_database);
    }

    public void Dispose()
    {
        try
        {
            if (Directory.Exists(_tempDir))
            {
                Directory.Delete(_tempDir, true);
            }
        }
        catch
        {
            // Ignore cleanup failure in temp
        }
    }

    [Fact]
    public void PasswordHasherHashesAndVerifiesCorrectly()
    {
        var password = "SecurePassword123!";
        var hash = PasswordHasher.HashPassword(password);

        Assert.NotEmpty(hash);
        Assert.True(PasswordHasher.VerifyPassword(password, hash));
        Assert.False(PasswordHasher.VerifyPassword("WrongPassword", hash));
        Assert.False(PasswordHasher.VerifyPassword(password, "invalid:hash"));
    }

    [Fact]
    public async Task UserManagementCanCreateAndRetrieveUsers()
    {
        var email = "alice@example.org";
        var password = "SuperSecretPassword!";
        var hash = PasswordHasher.HashPassword(password);

        var created = await _repository.CreateUserAsync("Alice Smith", email, hash, "admin", CancellationToken.None);
        Assert.True(created.Id > 0);
        Assert.Equal("Alice Smith", created.Name);
        Assert.Equal(email, created.Email);

        var fetched = await _repository.FindUserByEmailAsync(email, CancellationToken.None);
        Assert.NotNull(fetched);
        Assert.Equal(created.Id, fetched.Id);
        Assert.True(PasswordHasher.VerifyPassword(password, fetched.PasswordHash));

        var byId = await _repository.FindUserByIdAsync(created.Id, CancellationToken.None);
        Assert.NotNull(byId);
        Assert.Equal(email, byId.Email);
    }

    [Fact]
    public async Task EventSummariesIncludesConfiguredAndDatabaseEvents()
    {
        var configured = new List<EventSourceOptions>
        {
            new() { EventId = "event-1", EventName = "Event One", TemplateId = "default" }
        };

        var submission = new SheetSubmission(
            "event-1", "Event One", "hash", "1", 1,
            new Participant("p1", "Bob Jones", "bob@example.org", null),
            "p1", null, new Dictionary<string, string>());

        var (cert, _) = await _repository.GetOrCreateAsync(submission, configured[0], CancellationToken.None);
        await _repository.MarkIssuedAsync(cert.Id, "certs/bob.pdf", "sha", "thumb", configured[0], CancellationToken.None);

        var summaries = await _repository.GetEventSummariesAsync(configured, CancellationToken.None);
        Assert.Single(summaries);
        var s = summaries[0];
        Assert.Equal("event-1", s.EventId);
        Assert.Equal("Event One", s.EventName);
        Assert.Equal(1, s.TotalCount);
        Assert.Equal(1, s.IssuedCount);
        Assert.NotNull(s.EarliestCreatedAt);
    }

    [Fact]
    public async Task PaginatedCertificatesFiltersBySearchAndEventId()
    {
        var eventOpts = new EventSourceOptions { EventId = "hack-event", EventName = "Hack Event", TemplateId = "default" };

        var p1 = new SheetSubmission("hack-event", "Hack Event", "h1", "1", 1,
            new Participant("p1", "Alice Wonderland", "alice@test.org", null), "p1", null, new Dictionary<string, string>());
        var p2 = new SheetSubmission("hack-event", "Hack Event", "h2", "2", 2,
            new Participant("p2", "Charlie Brown", "charlie@test.org", null), "p2", null, new Dictionary<string, string>());

        await _repository.GetOrCreateAsync(p1, eventOpts, CancellationToken.None);
        await _repository.GetOrCreateAsync(p2, eventOpts, CancellationToken.None);

        var all = await _repository.GetCertificatesPaginatedAsync(1, 10, null, null, null, CancellationToken.None);
        Assert.Equal(2, all.TotalCount);
        Assert.Equal(2, all.Items.Count);

        var filtered = await _repository.GetCertificatesPaginatedAsync(1, 10, null, null, "Alice", CancellationToken.None);
        Assert.Equal(1, filtered.TotalCount);
        Assert.Equal("Alice Wonderland", filtered.Items[0].ParticipantName);
    }

    [Fact]
    public async Task CertificateWithCustomTemplateRecordsTemplateId()
    {
        var eventOpts = new EventSourceOptions
        {
            EventId = "custom-event",
            EventName = "Custom Event",
            TemplateId = "custom-my-template"
        };

        var submission = new SheetSubmission(
            "custom-event", "Custom Event", "hash", "1", 1,
            new Participant("p_custom", "Dave Custom", "dave@test.org", null),
            "p_custom", null, new Dictionary<string, string>());

        var (cert, _) = await _repository.GetOrCreateAsync(submission, eventOpts, CancellationToken.None);
        Assert.Equal("custom-my-template", cert.TemplateId);

        var retrieved = await _repository.FindByPublicIdAsync(cert.PublicId, CancellationToken.None);
        Assert.NotNull(retrieved);
        Assert.Equal("custom-my-template", retrieved.TemplateId);
    }
}
