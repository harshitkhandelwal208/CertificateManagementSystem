using System.Reflection;
using PdfSharp.Fonts;

namespace CertificateEngine.Certificates;

/// <summary>Provides the embedded, redistributable Noto Sans faces on every supported OS.</summary>
public sealed class EmbeddedFontResolver : IFontResolver
{
    private const string RegularFace = "CertificateEngine-NotoSans-Regular";
    private const string BoldFace = "CertificateEngine-NotoSans-Bold";
    private static readonly Assembly Assembly = typeof(EmbeddedFontResolver).Assembly;

    public FontResolverInfo? ResolveTypeface(string familyName, bool bold, bool italic)
    {
        var norm = (familyName ?? "").ToLowerInvariant();
        if (norm.Contains("times")) return new FontResolverInfo(bold ? "Sys-Times-Bold" : "Sys-Times-Regular");
        if (norm.Contains("georgia")) return new FontResolverInfo(bold ? "Sys-Georgia-Bold" : "Sys-Georgia-Regular");
        if (norm.Contains("arial")) return new FontResolverInfo(bold ? "Sys-Arial-Bold" : "Sys-Arial-Regular");
        if (norm.Contains("courier")) return new FontResolverInfo(bold ? "Sys-Courier-Bold" : "Sys-Courier-Regular");
        return new FontResolverInfo(bold ? BoldFace : RegularFace, mustSimulateBold: false, mustSimulateItalic: italic);
    }

    public byte[]? GetFont(string faceName) => faceName switch
    {
        RegularFace => ReadResource("CertificateEngine.Assets.Fonts.NotoSans-Regular.ttf"),
        BoldFace => ReadResource("CertificateEngine.Assets.Fonts.NotoSans-Bold.ttf"),
        "Sys-Times-Regular" => ReadTimesFont("CERTIFICATE_TIMES_REGULAR", @"C:\Windows\Fonts\times.ttf"),
        "Sys-Times-Bold" => ReadTimesFont("CERTIFICATE_TIMES_BOLD", @"C:\Windows\Fonts\timesbd.ttf"),
        "Sys-Georgia-Regular" => ReadConfiguredFont("CERTIFICATE_GEORGIA_REGULAR", "georgia.ttf"),
        "Sys-Georgia-Bold" => ReadConfiguredFont("CERTIFICATE_GEORGIA_BOLD", "georgiab.ttf"),
        "Sys-Arial-Regular" => ReadConfiguredFont("CERTIFICATE_ARIAL_REGULAR", "arial.ttf"),
        "Sys-Arial-Bold" => ReadConfiguredFont("CERTIFICATE_ARIAL_BOLD", "arialbd.ttf"),
        "Sys-Courier-Regular" => ReadConfiguredFont("CERTIFICATE_COURIER_REGULAR", "cour.ttf"),
        "Sys-Courier-Bold" => ReadConfiguredFont("CERTIFICATE_COURIER_BOLD", "courbd.ttf"),
        _ => null
    };

    private static byte[]? TryReadFile(string path) => File.Exists(path) ? File.ReadAllBytes(path) : null;

    private static byte[] ReadConfiguredFont(string environmentVariable, string fileName)
    {
        var configuredPath = Environment.GetEnvironmentVariable(environmentVariable);
        var font = string.IsNullOrWhiteSpace(configuredPath) ? null : TryReadFile(configuredPath);
        return font ?? TryReadFile(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Fonts), fileName))
            ?? TryReadFile(Path.Combine("/usr/share/fonts/truetype/msttcorefonts", fileName))
            ?? throw new InvalidOperationException($"Selected font is unavailable. Set {environmentVariable} to its font file.");
    }

    private static byte[] ReadTimesFont(string environmentVariable, string windowsPath)
    {
        var configuredPath = Environment.GetEnvironmentVariable(environmentVariable);
        var font = string.IsNullOrWhiteSpace(configuredPath) ? null : TryReadFile(configuredPath);
        var fileName = environmentVariable.EndsWith("BOLD", StringComparison.Ordinal) ? "timesbd.ttf" : "times.ttf";
        return font ?? TryReadFile(windowsPath)
            ?? TryReadFile(Path.Combine("/usr/share/fonts/truetype/msttcorefonts", fileName))
            ?? TryReadFile(Path.Combine("/usr/share/fonts/truetype/msttcorefonts", fileName.ToUpperInvariant()))
            ?? throw new InvalidOperationException(
            $"Times New Roman is unavailable. Install the font and set {environmentVariable} to its font file.");
    }

    private static byte[] ReadResource(string name)
    {
        using var stream = Assembly.GetManifestResourceStream(name)
            ?? throw new InvalidOperationException($"Embedded certificate font '{name}' was not found.");
        using var result = new MemoryStream();
        stream.CopyTo(result);
        return result.ToArray();
    }
}
