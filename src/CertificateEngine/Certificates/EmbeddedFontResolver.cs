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
        if (OperatingSystem.IsWindows())
        {
            if (norm.Contains("times")) return new FontResolverInfo(bold ? "Sys-Times-Bold" : "Sys-Times-Regular");
            if (norm.Contains("georgia")) return new FontResolverInfo(bold ? "Sys-Georgia-Bold" : "Sys-Georgia-Regular");
            if (norm.Contains("arial")) return new FontResolverInfo(bold ? "Sys-Arial-Bold" : "Sys-Arial-Regular");
            if (norm.Contains("courier")) return new FontResolverInfo(bold ? "Sys-Courier-Bold" : "Sys-Courier-Regular");
        }
        return new FontResolverInfo(bold ? BoldFace : RegularFace, mustSimulateBold: false, mustSimulateItalic: italic);
    }

    public byte[]? GetFont(string faceName) => faceName switch
    {
        RegularFace => ReadResource("CertificateEngine.Assets.Fonts.NotoSans-Regular.ttf"),
        BoldFace => ReadResource("CertificateEngine.Assets.Fonts.NotoSans-Bold.ttf"),
        "Sys-Times-Regular" => TryReadFile(@"C:\Windows\Fonts\times.ttf") ?? ReadResource("CertificateEngine.Assets.Fonts.NotoSans-Regular.ttf"),
        "Sys-Times-Bold" => TryReadFile(@"C:\Windows\Fonts\timesbd.ttf") ?? ReadResource("CertificateEngine.Assets.Fonts.NotoSans-Bold.ttf"),
        "Sys-Georgia-Regular" => TryReadFile(@"C:\Windows\Fonts\georgia.ttf") ?? ReadResource("CertificateEngine.Assets.Fonts.NotoSans-Regular.ttf"),
        "Sys-Georgia-Bold" => TryReadFile(@"C:\Windows\Fonts\georgiab.ttf") ?? ReadResource("CertificateEngine.Assets.Fonts.NotoSans-Bold.ttf"),
        "Sys-Arial-Regular" => TryReadFile(@"C:\Windows\Fonts\arial.ttf") ?? ReadResource("CertificateEngine.Assets.Fonts.NotoSans-Regular.ttf"),
        "Sys-Arial-Bold" => TryReadFile(@"C:\Windows\Fonts\arialbd.ttf") ?? ReadResource("CertificateEngine.Assets.Fonts.NotoSans-Bold.ttf"),
        "Sys-Courier-Regular" => TryReadFile(@"C:\Windows\Fonts\cour.ttf") ?? ReadResource("CertificateEngine.Assets.Fonts.NotoSans-Regular.ttf"),
        "Sys-Courier-Bold" => TryReadFile(@"C:\Windows\Fonts\courbd.ttf") ?? ReadResource("CertificateEngine.Assets.Fonts.NotoSans-Bold.ttf"),
        _ => null
    };

    private static byte[]? TryReadFile(string path) => File.Exists(path) ? File.ReadAllBytes(path) : null;

    private static byte[] ReadResource(string name)
    {
        using var stream = Assembly.GetManifestResourceStream(name)
            ?? throw new InvalidOperationException($"Embedded certificate font '{name}' was not found.");
        using var result = new MemoryStream();
        stream.CopyTo(result);
        return result.ToArray();
    }
}
