namespace CertificateEngine.Api;

public sealed record RevokeRequest(string Reason);

public sealed record TemplateLayoutDto(
    double XPercent,
    double YPercent,
    double FontSize,
    string? FontFamily = null,
    string? FontWeight = null,
    string? Color = null,
    string? TextAlign = null);

public sealed record DemoIssueRequest(
    string FullName,
    string? EventName = null,
    string? EventId = null,
    string? Email = null,
    string? Phone = null,
    string? TemplateId = null,
    TemplateLayoutDto? Layout = null);

public sealed record BatchIssueRecipient(
    string Name,
    string? Email = null,
    string? Phone = null);

public sealed record BatchIssueRequest(
    List<BatchIssueRecipient> Recipients,
    string? EventId = null,
    string? EventName = null,
    string? TemplateId = null,
    TemplateLayoutDto? Layout = null);

public sealed record LoginRequest(string Email, string Password);

public sealed record RegisterRequest(string Name, string Email, string Password);

public sealed record RefreshRequest(string RefreshToken);

public sealed record UserInfo(long Id, string Name, string Email, string Role);

public sealed record AuthResponse(string AccessToken, string RefreshToken, UserInfo User);

public sealed record EventSummaryDto(
    string EventId,
    string EventName,
    string TemplateId,
    string? EarliestCreatedAt,
    int IssuedCount,
    int TotalCount);

public sealed record CertificateSummaryDto(
    string PublicId,
    string CertificateNumber,
    string ParticipantName,
    string? ParticipantEmail,
    string EventId,
    string EventName,
    string TemplateId,
    string Status,
    string CreatedAt,
    string? IssuedAt,
    string? RevokedAt,
    string? RevocationReason);

public sealed record PaginatedResultDto<T>(
    List<T> Items,
    int Page,
    int PageSize,
    int TotalCount);

public sealed record EventDetailDto(
    string EventId,
    string EventName,
    string TemplateId,
    string? EarliestCreatedAt,
    int IssuedCount,
    int TotalCount,
    PaginatedResultDto<CertificateSummaryDto> Certificates);

public sealed record UserRecord(
    long Id,
    string Name,
    string Email,
    string PasswordHash,
    string Role,
    DateTimeOffset CreatedAt);
