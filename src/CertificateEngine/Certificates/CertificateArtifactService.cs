using System.Security.Cryptography;
using System.Security.Cryptography.Pkcs;
using System.Security.Cryptography.X509Certificates;
using CertificateEngine.Api;
using CertificateEngine.Configuration;
using CertificateEngine.Domain;
using CertificateEngine.Infrastructure.Persistence;
using Microsoft.Extensions.Options;
using PdfSharp.Drawing;
using PdfSharp.Fonts;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;
using PdfTextDocument = UglyToad.PdfPig.PdfDocument;
using QRCoder;

namespace CertificateEngine.Certificates;

public sealed class CertificateArtifactService : IDisposable
{
    private static readonly object FontResolverLock = new();
    private readonly CertificateDatabase _database;
    private readonly PlatformOptions _platform;
    private readonly SigningOptions _signing;
    private readonly X509Certificate2? _signingCertificate;
    private readonly X509Certificate2? _trustedRoot;

    public CertificateArtifactService(CertificateDatabase database, IOptions<PlatformOptions> platform, IOptions<SigningOptions> signing)
    {
        _database = database;
        _platform = platform.Value;
        _signing = signing.Value;
        if (_signing.Enabled)
        {
            _signingCertificate = new X509Certificate2(ResolvePath(_signing.PfxPath), _signing.PfxPassword,
                X509KeyStorageFlags.EphemeralKeySet | X509KeyStorageFlags.Exportable);
            if (!_signingCertificate.HasPrivateKey)
                throw new InvalidOperationException("Signing:PfxPath does not contain a private key.");
            _trustedRoot = X509Certificate2.CreateFromPem(File.ReadAllText(ResolvePath(_signing.TrustedRootPath)));
        }
    }

    public Task<(string ArtifactPath, string Sha256, string SignerThumbprint)> CreateAsync(CertificateRecord certificate, CancellationToken cancellationToken)
        => CreateAsync(certificate, null, cancellationToken);

    public async Task<(string ArtifactPath, string Sha256, string SignerThumbprint)> CreateAsync(CertificateRecord certificate, TemplateLayoutDto? explicitLayout, CancellationToken cancellationToken)
    {
        var relative = Path.Combine("certificates", $"{certificate.PublicId}.pdf");
        var fullPath = Path.Combine(_database.DataDirectory, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);
        var bytes = Render(certificate, explicitLayout);
        await File.WriteAllBytesAsync(fullPath, bytes, cancellationToken);
        var hash = Convert.ToHexString(SHA256.HashData(bytes));
        var thumbprint = _signingCertificate?.Thumbprint ?? "UNSIGNED";
        if (_signingCertificate is not null)
        {
            var cms = new SignedCms(new ContentInfo(bytes), detached: true);
            var signer = new CmsSigner(SubjectIdentifierType.IssuerAndSerialNumber, _signingCertificate)
            {
                IncludeOption = X509IncludeOption.ExcludeRoot,
                DigestAlgorithm = new Oid("2.16.840.1.101.3.4.2.1")
            };
            cms.ComputeSignature(signer, silent: true);
            await File.WriteAllBytesAsync(fullPath + ".p7s", cms.Encode(), cancellationToken);
        }
        return (relative.Replace('\\', '/'), hash, thumbprint);
    }

    public async Task<bool> VerifyAsync(CertificateRecord certificate, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(certificate.ArtifactPath) || string.IsNullOrWhiteSpace(certificate.ArtifactSha256)) return false;
        var pdf = await File.ReadAllBytesAsync(ResolveArtifactPath(certificate.ArtifactPath), cancellationToken);
        if (!CryptographicOperations.FixedTimeEquals(Convert.FromHexString(certificate.ArtifactSha256), SHA256.HashData(pdf))) return false;
        if (_signingCertificate is null) return certificate.SignerThumbprint == "UNSIGNED";
        var signaturePath = ResolveArtifactPath(certificate.ArtifactPath) + ".p7s";
        if (!File.Exists(signaturePath)) return false;
        var cms = new SignedCms(new ContentInfo(pdf), detached: true);
        cms.Decode(await File.ReadAllBytesAsync(signaturePath, cancellationToken));
        cms.CheckSignature(verifySignatureOnly: true);
        var signer = cms.SignerInfos.Count == 1 ? cms.SignerInfos[0].Certificate : null;
        if (signer is null || !string.Equals(signer.Thumbprint, _signingCertificate.Thumbprint, StringComparison.OrdinalIgnoreCase)) return false;
        using var chain = new X509Chain();
        chain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
        chain.ChainPolicy.CustomTrustStore.Add(_trustedRoot!);
        chain.ChainPolicy.ExtraStore.AddRange(cms.Certificates);
        chain.ChainPolicy.VerificationFlags = X509VerificationFlags.NoFlag;
        return chain.Build(signer);
    }

    private byte[] Render(CertificateRecord certificate, TemplateLayoutDto? explicitLayout = null)
    {
        EnsureFontResolver();
        var customTemplatePath = ResolveCustomTemplatePath(certificate.TemplateId);
        using var sourceDocument = customTemplatePath is null
            ? null
            : PdfReader.Open(customTemplatePath, PdfDocumentOpenMode.Import);
        var document = new PdfDocument();
        document.Info.Title = "Certificate of Completion";
        document.Info.Author = _platform.OrganizationName;
        var page = sourceDocument is null
            ? document.AddPage()
            : document.AddPage(sourceDocument.Pages[0]);
        if (sourceDocument is null) page.Orientation = PdfSharp.PageOrientation.Landscape;
        var gfx = XGraphics.FromPdfPage(page);
        var width = page.Width.Point; var height = page.Height.Point;
        if (customTemplatePath is null)
        {
            gfx.DrawRectangle(new XPen(XColor.FromArgb(25, 75, 130), 4), 18, 18, width - 36, height - 36);
            gfx.DrawString(_platform.OrganizationName, new XFont("Noto Sans", 26, XFontStyleEx.Bold), XBrushes.DarkSlateBlue, new XRect(45, 60, width - 90, 40), XStringFormats.TopCenter);
            gfx.DrawString("CERTIFICATE OF COMPLETION", new XFont("Noto Sans", 20, XFontStyleEx.Bold), XBrushes.Black, new XRect(45, 120, width - 90, 35), XStringFormats.TopCenter);
            gfx.DrawString("This is proudly presented to", new XFont("Noto Sans", 13), XBrushes.Black, new XRect(45, 180, width - 90, 25), XStringFormats.TopCenter);
            gfx.DrawString(certificate.ParticipantName, new XFont("Noto Sans", 30, XFontStyleEx.Bold), XBrushes.DarkSlateBlue, new XRect(45, 215, width - 90, 42), XStringFormats.TopCenter);
            gfx.DrawString($"for successfully participating in {certificate.EventName}", new XFont("Noto Sans", 13), XBrushes.Black, new XRect(45, 280, width - 90, 25), XStringFormats.TopCenter);
            gfx.DrawString($"Certificate No. {certificate.CertificateNumber}    Issued {DateTimeOffset.UtcNow:yyyy-MM-dd}", new XFont("Noto Sans", 9), XBrushes.DimGray, new XRect(45, 350, width - 150, 18), XStringFormats.TopCenter);
        }
        else
        {
            CustomTemplateLayout? customLayout = null;
            if (explicitLayout is not null)
            {
                customLayout = new CustomTemplateLayout(
                    explicitLayout.XPercent,
                    explicitLayout.YPercent,
                    explicitLayout.FontSize,
                    explicitLayout.FontFamily ?? "Noto Sans",
                    explicitLayout.FontWeight ?? "bold",
                    explicitLayout.Color ?? "#000000",
                    explicitLayout.TextAlign ?? "center");
            }
            else
            {
                customLayout = ResolveCustomTemplateLayout(certificate.TemplateId);
            }
            if (customLayout is not null)
            {
                var fontSize = Math.Clamp(customLayout.FontSize, 12, 80);
                var fontStyle = string.Equals(customLayout.FontWeight, "bold", StringComparison.OrdinalIgnoreCase)
                    ? XFontStyleEx.Bold
                    : XFontStyleEx.Regular;
                var font = new XFont(customLayout.FontFamily, fontSize, fontStyle);
                var brush = ParseHexColor(customLayout.Color);

                XRect nameRect;
                XStringFormat format;
                var x = (customLayout.XPercent / 100.0) * width;
                var y = (customLayout.YPercent / 100.0) * height;

                var boxHeight = fontSize * 1.5;
                var yTop = y - (boxHeight / 2.0);

                if (string.Equals(customLayout.TextAlign, "left", StringComparison.OrdinalIgnoreCase))
                {
                    nameRect = new XRect(x, yTop, Math.Max(width - x - 20, 100), boxHeight);
                    format = XStringFormats.CenterLeft;
                }
                else if (string.Equals(customLayout.TextAlign, "right", StringComparison.OrdinalIgnoreCase))
                {
                    nameRect = new XRect(20, yTop, Math.Max(x - 20, 100), boxHeight);
                    format = XStringFormats.CenterRight;
                }
                else
                {
                    var boxWidth = Math.Min(x, width - x) * 2;
                    nameRect = new XRect(x - (boxWidth / 2.0), yTop, Math.Max(boxWidth, 100), boxHeight);
                    format = XStringFormats.Center;
                }

                gfx.DrawString(certificate.ParticipantName, font, brush, nameRect, format);
            }
            else
            {
                var namePlacement = FindNamePlaceholder(customTemplatePath, height);
                var nameRect = namePlacement?.Bounds ?? new XRect(width * 0.1, height * 0.38, width * 0.8, 50);
                var nameFontSize = namePlacement?.FontSize ?? 26;
                if (namePlacement is not null)
                {
                    gfx.DrawRectangle(XBrushes.White, namePlacement.Bounds);
                }
                gfx.DrawString(certificate.ParticipantName, new XFont("Noto Sans", nameFontSize, XFontStyleEx.Bold), XBrushes.Black, nameRect, XStringFormats.TopCenter);
            }
        }
        var verify = new Uri(new Uri(_platform.PublicBaseUrl.TrimEnd('/') + "/"), "verify/" + certificate.PublicId).ToString();
        using var generator = new QRCodeGenerator();
        using var qr = generator.CreateQrCode(verify, QRCodeGenerator.ECCLevel.Q);
        var qrSize = Math.Min(75d, height - 130d);
        var moduleSize = qrSize / qr.ModuleMatrix.Count;
        var qrLeft = width - 115d;
        var qrTop = height - 115d;
        gfx.DrawRectangle(XBrushes.White, qrLeft - 4, qrTop - 4, qrSize + 8, qrSize + 8);
        for (var row = 0; row < qr.ModuleMatrix.Count; row++)
        {
            for (var column = 0; column < qr.ModuleMatrix[row].Count; column++)
            {
                if (qr.ModuleMatrix[row][column])
                {
                    gfx.DrawRectangle(XBrushes.Black, qrLeft + (column * moduleSize), qrTop + (row * moduleSize), moduleSize, moduleSize);
                }
            }
        }
        gfx.DrawString("Scan to verify", new XFont("Noto Sans", 7), XBrushes.DimGray, new XRect(width - 125, height - 37, 95, 12), XStringFormats.TopCenter);
        using var stream = new MemoryStream(); document.Save(stream, false); return stream.ToArray();
    }

    private string? ResolveCustomTemplatePath(string templateId)
    {
        if (!templateId.StartsWith("custom-", StringComparison.OrdinalIgnoreCase)) return null;
        var safeId = new string(templateId.Select(character => char.IsLetterOrDigit(character) || character is '-' or '_' ? character : '-').ToArray());
        var path = Path.Combine(_database.DataDirectory, "templates", $"{safeId}.pdf");
        if (File.Exists(path)) return path;

        if (safeId.StartsWith("custom-event-", StringComparison.OrdinalIgnoreCase))
        {
            var stripped = "custom-" + safeId["custom-event-".Length..];
            var strippedPath = Path.Combine(_database.DataDirectory, "templates", $"{stripped}.pdf");
            if (File.Exists(strippedPath)) return strippedPath;
        }

        var fallback = Path.Combine(_database.DataDirectory, "templates", "custom-new-event.pdf");
        if (File.Exists(fallback)) return fallback;

        // Any custom pdf in data/templates
        var templatesDir = Path.Combine(_database.DataDirectory, "templates");
        if (Directory.Exists(templatesDir))
        {
            var anyPdf = Directory.GetFiles(templatesDir, "custom-*.pdf").FirstOrDefault();
            if (anyPdf is not null) return anyPdf;
        }

        throw new FileNotFoundException("Custom PDF template was not found.", path);
    }

    private CustomTemplateLayout? ResolveCustomTemplateLayout(string templateId)
    {
        if (!templateId.StartsWith("custom-", StringComparison.OrdinalIgnoreCase)) return null;
        var safeId = new string(templateId.Select(character => char.IsLetterOrDigit(character) || character is '-' or '_' ? character : '-').ToArray());
        var path = Path.Combine(_database.DataDirectory, "templates", $"{safeId}.json");
        if (!File.Exists(path))
        {
            if (safeId.StartsWith("custom-event-", StringComparison.OrdinalIgnoreCase))
            {
                var stripped = "custom-" + safeId["custom-event-".Length..];
                var strippedPath = Path.Combine(_database.DataDirectory, "templates", $"{stripped}.json");
                if (File.Exists(strippedPath)) path = strippedPath;
            }
            if (!File.Exists(path))
            {
                var fallback = Path.Combine(_database.DataDirectory, "templates", "custom-new-event.json");
                if (File.Exists(fallback)) path = fallback;
                else
                {
                    var templatesDir = Path.Combine(_database.DataDirectory, "templates");
                    var anyJson = Directory.Exists(templatesDir) ? Directory.GetFiles(templatesDir, "custom-*.json").FirstOrDefault() : null;
                    if (anyJson is not null) path = anyJson;
                    else return null;
                }
            }
        }
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(path));
            var root = doc.RootElement;
            var x = root.TryGetProperty("xPercent", out var xProp) ? xProp.GetDouble() : 50;
            var y = root.TryGetProperty("yPercent", out var yProp) ? yProp.GetDouble() : 40;
            var size = root.TryGetProperty("fontSize", out var sProp) ? sProp.GetDouble() : 28;
            var font = root.TryGetProperty("fontFamily", out var fProp) ? fProp.GetString() ?? "Noto Sans" : "Noto Sans";
            var weight = root.TryGetProperty("fontWeight", out var wProp) ? wProp.GetString() ?? "bold" : "bold";
            var color = root.TryGetProperty("color", out var cProp) ? cProp.GetString() ?? "#000000" : "#000000";
            var align = root.TryGetProperty("textAlign", out var aProp) ? aProp.GetString() ?? "center" : "center";
            return new CustomTemplateLayout(x, y, size, font, weight, color, align);
        }
        catch
        {
            return null;
        }
    }

    private static XSolidBrush ParseHexColor(string hex)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(hex)) return new XSolidBrush(XColors.Black);
            if (hex.StartsWith('#')) hex = hex[1..];
            if (hex.Length == 6)
            {
                var r = byte.Parse(hex[..2], System.Globalization.NumberStyles.HexNumber, System.Globalization.CultureInfo.InvariantCulture);
                var g = byte.Parse(hex[2..4], System.Globalization.NumberStyles.HexNumber, System.Globalization.CultureInfo.InvariantCulture);
                var b = byte.Parse(hex[4..6], System.Globalization.NumberStyles.HexNumber, System.Globalization.CultureInfo.InvariantCulture);
                return new XSolidBrush(XColor.FromArgb(r, g, b));
            }
        }
        catch {}
        return new XSolidBrush(XColors.Black);
    }

    private sealed record CustomTemplateLayout(
        double XPercent,
        double YPercent,
        double FontSize,
        string FontFamily,
        string FontWeight,
        string Color,
        string TextAlign);

    private static NamePlacement? FindNamePlaceholder(string templatePath, double pageHeight)
    {
        try
        {
            using var document = PdfTextDocument.Open(templatePath);
            var word = document.GetPage(1).GetWords().FirstOrDefault(candidate =>
            {
                var marker = new string(candidate.Text.Trim().Where(char.IsLetter).ToArray());
                return marker.Equals("XYZ", StringComparison.OrdinalIgnoreCase)
                    || marker.Equals("NAME", StringComparison.OrdinalIgnoreCase)
                    || marker.Equals("RECIPIENTNAME", StringComparison.OrdinalIgnoreCase)
                    || marker.Equals("PARTICIPANTNAME", StringComparison.OrdinalIgnoreCase)
                    || marker.Equals("YOURNAME", StringComparison.OrdinalIgnoreCase);
            });
            if (word is null) return null;

            var box = word.BoundingBox;
            var bounds = new XRect(
                box.Left - 8,
                pageHeight - box.Top - 8,
                Math.Max(box.Width + 16, 120),
                Math.Max(box.Height + 16, 34));
            return new NamePlacement(bounds, Math.Clamp(box.Height * 0.85, 18, 36));
        }
        catch (Exception)
        {
            return null;
        }
    }

    private sealed record NamePlacement(XRect Bounds, double FontSize);

    private string ResolveArtifactPath(string artifactPath) => Path.Combine(_database.DataDirectory, artifactPath.Replace('/', Path.DirectorySeparatorChar));
    private static void EnsureFontResolver()
    {
        lock (FontResolverLock)
        {
            GlobalFontSettings.FontResolver ??= new EmbeddedFontResolver();
        }
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
    public void Dispose()
    {
        _signingCertificate?.Dispose();
        _trustedRoot?.Dispose();
    }
}
