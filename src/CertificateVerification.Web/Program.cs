using System.Text.Encodings.Web;
using System.Globalization;
using CertificateVerification.Web;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin()
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});
builder.Services.Configure<VerificationOptions>(builder.Configuration.GetSection(VerificationOptions.SectionName));
builder.Services.AddSingleton<CertificateLookup>();
var app = builder.Build();
app.UseCors();

app.MapGet("/favicon.ico", () => Results.Redirect("http://localhost:3000/favicon.ico"));
app.MapGet("/", () => Results.Redirect("http://localhost:3000/verify"));
app.MapGet("/verify/{publicId}", (string publicId) => Results.Redirect($"http://localhost:3000/verify/{Uri.EscapeDataString(publicId)}"));
app.MapGet("/api/verify/{publicId}", async (string publicId, CertificateLookup lookup, CancellationToken ct) =>
{
    var certificate = await lookup.FindAsync(publicId, ct);
    return certificate is null ? Results.NotFound(new { publicId, status = "NotFound" }) : Results.Ok(new { publicId = certificate.Record.PublicId, status = certificate.Status, certificateNumber = certificate.Record.CertificateNumber, participantName = certificate.Record.ParticipantName, eventName = certificate.Record.EventName, templateId = certificate.Record.TemplateId, issuedAtUtc = certificate.Record.IssuedAt, revokedAtUtc = certificate.Record.RevokedAt, revocationReason = certificate.Record.RevocationReason, signatureValid = certificate.SignatureValid, fileSha256 = certificate.Record.ArtifactSha256 });
});
await app.RunAsync();
