using CertificateEngine.Api;
using CertificateEngine.Certificates;
using CertificateEngine.Configuration;
using CertificateEngine.Domain;
using CertificateEngine.Infrastructure.Persistence;
using Microsoft.Extensions.Options;
using PdfSharp.Pdf;
using PdfSharp.Drawing;
using PdfSharp.Fonts;
using PdfTextDocument = UglyToad.PdfPig.PdfDocument;
using Xunit;

namespace CertificateEngine.Tests;

public class TemplatePlacementTests
{
    [Fact]
    public async Task IssuedCertificatePreservesUploadedBackgroundAndAdditionalPages()
    {
        var dir = Path.Combine(Path.GetTempPath(), "certificate-background-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(dir, "templates"));
        try
        {
            GlobalFontSettings.FontResolver ??= new EmbeddedFontResolver();
            using (var background = new PdfDocument())
            {
                foreach (var text in new[] { "Original Design", "Second Page" })
                {
                    var page = background.AddPage();
                    using var gfx = XGraphics.FromPdfPage(page);
                    gfx.DrawString(text, new XFont("Noto Sans", 20), XBrushes.Black, new XRect(30, 30, 300, 40), XStringFormats.TopLeft);
                }
                background.Save(Path.Combine(dir, "templates", "custom-test.pdf"));
            }
            var platform = Options.Create(new PlatformOptions { DataDirectory = dir, PublicBaseUrl = "http://localhost:5001" });
            var database = new CertificateDatabase(platform);
            await database.InitializeAsync(CancellationToken.None);
            var repository = new CertificateRepository(database);
            var eventOptions = new EventSourceOptions { EventId = "test", EventName = "Test", TemplateId = "custom-test" };
            var submission = new SheetSubmission("test", "Test", "hash", "1", 1,
                new Participant("1", "John Doe", null, null), "1", null, new Dictionary<string, string>());
            var (certificate, _) = await repository.GetOrCreateAsync(submission, eventOptions, CancellationToken.None);
            using var service = new CertificateArtifactService(database, platform, Options.Create(new SigningOptions { Enabled = false }));
            var (artifact, _, _) = await service.CreateAsync(certificate, new TemplateLayoutDto(40, 35, 28, "Noto Sans", "bold", "#000000", "center"), CancellationToken.None);
            using var result = PdfTextDocument.Open(Path.Combine(dir, artifact));
            Assert.Equal(2, result.NumberOfPages);
            Assert.Contains("Original Design", result.GetPage(1).Text);
            Assert.Contains("John Doe", result.GetPage(1).Text);
            Assert.Contains("Second Page", result.GetPage(2).Text);
        }
        finally { Directory.Delete(dir, true); }
    }

    [Theory]
    [InlineData(400, 300, "left")]
    [InlineData(400, 300, "center")]
    [InlineData(1000, 700, "right")]
    [InlineData(1000, 700, "center")]
    public async Task OutputUsesRequestedAnchorOnDifferentPageSizes(int width, int height, string alignment)
    {
        var dir = Path.Combine(Path.GetTempPath(), "certificate-placement-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(dir, "templates"));
        try
        {
            using (var background = new PdfDocument())
            {
                var page = background.AddPage();
                page.Width = XUnit.FromPoint(width); page.Height = XUnit.FromPoint(height);
                background.Save(Path.Combine(dir, "templates", "custom-test.pdf"));
            }
            var platform = Options.Create(new PlatformOptions { DataDirectory = dir, PublicBaseUrl = "http://localhost:5001" });
            var database = new CertificateDatabase(platform);
            await database.InitializeAsync(CancellationToken.None);
            var repository = new CertificateRepository(database);
            var eventOptions = new EventSourceOptions { EventId = "test", EventName = "Test", TemplateId = "custom-test" };
            var submission = new SheetSubmission("test", "Test", "hash", "1", 1,
                new Participant("1", "John Doe", null, null), "1", null, new Dictionary<string, string>());
            var (certificate, _) = await repository.GetOrCreateAsync(submission, eventOptions, CancellationToken.None);
            using var service = new CertificateArtifactService(database, platform, Options.Create(new SigningOptions { Enabled = false }));
            var (artifact, _, _) = await service.CreateAsync(certificate, new TemplateLayoutDto(40, 35, 28, "Noto Sans", "bold", "#000000", alignment), CancellationToken.None);
            using var result = PdfTextDocument.Open(Path.Combine(dir, artifact));
            var words = result.GetPage(1).GetWords().Where(w => w.Text is "John" or "Doe").ToArray();
            Assert.Equal(2, words.Length);
            var left = words.Min(w => w.BoundingBox.Left);
            var right = words.Max(w => w.BoundingBox.Right);
            var anchor = alignment == "left" ? left : alignment == "right" ? right : (left + right) / 2;
            Assert.InRange(anchor, width * .4 - 4, width * .4 + 4);
            var middleY = (words.Min(w => w.BoundingBox.Bottom) + words.Max(w => w.BoundingBox.Top)) / 2;
            Assert.InRange(middleY, height * .65 - 8, height * .65 + 8);
        }
        finally { Directory.Delete(dir, true); }
    }
}
