namespace CertificateEngine.Configuration;

public sealed class PlatformOptions
{
    public const string SectionName = "Platform";

    public string OrganizationName { get; init; } = "Your NGO";
    public string PublicBaseUrl { get; init; } = "http://localhost:5001";
    public string DataDirectory { get; init; } = "data";
    // This only makes a zero-configuration local test launch usable. Replace it in every
    // deployed environment with a random secret supplied through configuration.
    public string InternalApiKey { get; init; } = "local-testing-key-change-before-production-2026";
    public int PollIntervalSeconds { get; init; } = 90;
    public int DeliveryPollSeconds { get; init; } = 5;
    public int MaxDeliveryAttempts { get; init; } = 5;
    public List<EventSourceOptions> Events { get; init; } = [];
}

public sealed class EventSourceOptions
{
    public string EventId { get; init; } = string.Empty;
    public string EventName { get; set; } = string.Empty;
    public string SpreadsheetId { get; init; } = string.Empty;
    public string SheetName { get; init; } = "Form Responses 1";
    public string Range { get; init; } = "A:ZZ";
    public string TemplateId { get; set; } = "default";

    public string SourceIdColumn { get; init; } = "Timestamp";
    public string NameColumn { get; init; } = "Full Name";
    public string EmailColumn { get; init; } = "Email Address";
    public string PhoneColumn { get; init; } = "Phone Number";
    public string ApprovalColumn { get; init; } = "Status";
    public string ApprovalValue { get; init; } = "Approved";
    public string? ScoreColumn { get; init; }
    public decimal? MinimumScore { get; init; }

    public string CertificateStatusColumn { get; init; } = "Certificate Status";
    public string VerificationIdColumn { get; init; } = "Verification ID";
    public string ProcessedAtColumn { get; init; } = "Certificate Processed At";

    public bool SendEmail { get; init; } = true;
    public bool SendWhatsApp { get; init; }
    public bool EmailFallbackForWhatsApp { get; init; } = true;
}
